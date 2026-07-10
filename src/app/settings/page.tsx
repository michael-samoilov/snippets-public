"use client";

import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useTheme } from "next-themes";
import { format, isToday, isYesterday } from "date-fns";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { eraseAll } from "@/lib/db";
import { enroll, getBookKey, recoveryKitText, refreshEnrollment, unlock } from "@/lib/e2e";
import { checkPassphrase, type PassphraseStrength } from "@/lib/passphrase";
import {
  adoptDriveToken,
  deliverBackup,
  forgetDriveTokens,
  hasDriveToken,
} from "@/lib/backup-client";
import { backupHealth } from "@/lib/backup-shared";
import { exportJSON, exportMarkdown, importJSON } from "@/lib/export";
import { updateSettings, useSettings } from "@/lib/settings";
import { useStats } from "@/hooks/use-snippets";
import { useOnline } from "@/hooks/use-online";
import { signOut, useSession } from "@/lib/auth";
import { authClient } from "@/lib/auth-client";
import {
  disableEncryption,
  releaseBinding,
  reconcile,
  requestSync,
  useSyncStatus,
} from "@/lib/sync";
import { formatBytes, useStorageHealth } from "@/lib/storage-health";
import { PaperButton } from "@/components/paper-button";
import { PageBackHeader } from "@/components/page-back-header";
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "account", label: copy.settings.tabs.account },
  { id: "appearance", label: copy.settings.tabs.appearance },
] as const;
type TabId = (typeof TABS)[number]["id"];

// The open panel lives in the URL (?tab=appearance) so a link lands on it and
// a reload keeps it. Account is the default (it holds the protections a
// visitor comes to check; ?tab=account is honoured for old links). Read it
// through useSyncExternalStore — the server and first paint show the
// default, the client adopts the query with no hydration flash, and
// back/forward just work. replaceState is silent, so a tap dispatches a
// custom event to nudge the store.
const TAB_EVENT = "settings:tab";

function readTab(): TabId {
  return new URLSearchParams(window.location.search).get("tab") === "appearance"
    ? "appearance"
    : "account";
}

function subscribeTab(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  window.addEventListener(TAB_EVENT, onChange);
  return () => {
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(TAB_EVENT, onChange);
  };
}

function selectTab(id: TabId) {
  const url = new URL(window.location.href);
  if (id === "account") url.searchParams.delete("tab");
  else url.searchParams.set("tab", id);
  window.history.replaceState(null, "", url);
  window.dispatchEvent(new Event(TAB_EVENT));
}

/**
 * Two quiet sections, small-caps, over the same hairline the headings
 * use — the active one carries a wax underline that magic-moves between
 * them. Arrow keys walk the row (roving tabindex); the URL remembers
 * which panel is open so a link can land on either.
 */
function SettingsTabs({
  tab,
  onSelect,
}: {
  tab: TabId;
  onSelect: (id: TabId) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (event: ReactKeyboardEvent, index: number) => {
    let next = -1;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    event.preventDefault();
    onSelect(TABS[next].id);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={copy.settings.tabs.label}
      className="mb-9 flex gap-1 border-b border-rule"
    >
      {TABS.map((t, index) => {
        const active = t.id === tab;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="tab"
            id={`settings-tab-${t.id}`}
            aria-selected={active}
            aria-controls={`settings-panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(t.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
            className={cn(
              "voice-label pressable relative -mb-px rounded-t-[5px] px-3 py-2 text-[0.82rem]",
              active ? "text-wax" : "text-ink-soft hover:text-ink",
            )}
          >
            {t.label}
            {active && (
              <motion.span
                aria-hidden="true"
                layoutId="settings-tab-underline"
                className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-wax"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── protection strip ─────────────────────────────────────────────
// A quiet at-a-glance confidence row atop the Account tab: is each
// protection actually live? Wax = live & good, ember = needs attention,
// ink-faint = off. It only ever mirrors real state — never over-claims
// (an unknown enrollment reads neutral, never a false "Encrypted").

type ProtState = "good" | "attention" | "off";

const protTone: Record<ProtState, string> = {
  good: "text-wax",
  attention: "text-ember",
  off: "text-ink-faint",
};

// Same Feather stroke as the account-menu marks (1.8 on a 24 viewBox).
const stripIcon = {
  "aria-hidden": true,
  viewBox: "0 0 24 24",
  width: 16,
  height: 16,
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function ShieldGlyph() {
  return (
    <svg {...stripIcon}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}
function SyncGlyph() {
  return (
    <svg {...stripIcon}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
    </svg>
  );
}
function FolderGlyph() {
  return (
    <svg {...stripIcon}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function formatDelivered(iso: string): string {
  const at = new Date(iso);
  if (isToday(at)) return format(at, "h:mm a");
  if (isYesterday(at)) return `yesterday, ${format(at, "h:mm a")}`;
  return format(at, "MMMM d");
}

// The glyph is centred with the label line; the description drops to its
// own full line beneath — mono, matching the sync/backup readouts.
function ProtRow({
  glyph,
  word,
  sub,
  state,
}: {
  glyph: React.ReactNode;
  word: string;
  sub: string;
  state: ProtState;
}) {
  return (
    <div className="grid grid-cols-[1.25rem_1fr] items-center gap-x-3 gap-y-1">
      <span className={`flex justify-center ${protTone[state]}`}>{glyph}</span>
      <span className={`voice-label text-[0.8rem] ${protTone[state]}`}>{word}</span>
      {sub && <p className="col-start-2 voice-data text-ink-soft">{sub}</p>}
    </div>
  );
}

// Sync state → its indicator row (lives in the Account section). Always on
// when signed in; only errors and the encryption lock are "attention" —
// offline is expected, never red.
function syncRow(
  sync: ReturnType<typeof useSyncStatus>,
  online: boolean,
): { word: string; sub: string; state: ProtState } {
  const c = copy.settings.protection;
  if (sync.locked)
    return {
      word: c.syncPaused,
      // counts are fetched even while locked (see sync.ts), so the pause
      // can say concretely what waits behind it
      sub: c.syncPausedSub(
        sync.localCount !== null ? sync.localCount.toLocaleString() : null,
        sync.serverCount !== null ? sync.serverCount.toLocaleString() : null,
      ),
      state: "attention",
    };
  if (sync.phase === "signedOut")
    // an expired session must say so, or pending writes pile up under an
    // unexplained count
    return { word: c.signedOut, sub: c.signedOutSub, state: "attention" };
  if (sync.phase === "error")
    return { word: c.syncSnag, sub: c.syncSnagSub, state: "attention" };
  if (sync.phase === "offline")
    return { word: c.offline, sub: c.offlineSub, state: "off" };
  if (sync.phase === "syncing" || sync.pendingCount > 0)
    return { word: c.syncing, sub: c.syncingSub, state: "good" };
  if (sync.lastSyncedAt === null)
    return { word: c.syncing, sub: c.syncWaitingSub, state: "good" };
  const when = format(
    sync.lastSyncedAt,
    isToday(sync.lastSyncedAt) ? "h:mm a" : "MMM d",
  );
  // the device/server integrity counts, folded into this one readout line
  let counts: string | null = null;
  if (sync.localCount !== null) {
    const device = sync.localCount.toLocaleString();
    if (!online) counts = copy.settings.sync.countsOffline(device);
    else if (sync.serverCount !== null)
      counts = copy.settings.sync.counts(device, sync.serverCount.toLocaleString());
    else counts = copy.settings.account.deviceCount(device, sync.localCount === 1);
  }
  return { word: c.synced, sub: c.syncedSub(when, counts), state: "good" };
}

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const stats = useStats();
  const { user } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);
  const tab = useSyncExternalStore<TabId>(
    subscribeTab,
    readTab,
    () => "account",
  );
  // theme is unknowable server-side; render the swatches neutral until hydrated
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  const onImport = async (file: File) => {
    try {
      const count = await importJSON(file);
      toast(copy.settings.toasts.restored(count));
    } catch (error) {
      toast(copy.settings.toasts.importFailed, {
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };

  return (
    <PageBackHeader title={copy.settings.title}>
      <SettingsTabs tab={tab} onSelect={selectTab} />

      {tab === "appearance" ? (
        <div
          role="tabpanel"
          id="settings-panel-appearance"
          aria-labelledby="settings-tab-appearance"
          className="space-y-10"
        >
        <section aria-label={copy.settings.appearance.themeLabel}>
          <h2 className="voice-label border-b border-rule pb-1.5">{copy.settings.appearance.themeLabel}</h2>
          <div className="mt-4 grid grid-cols-3 gap-3" role="radiogroup" aria-label={copy.settings.appearance.themeLabel}>
            <ThemeSwatch
              label={copy.themes.paper}
              active={mounted && theme === "light"}
              onPick={() => setTheme("light")}
              paper="#f7f1e3"
              desk="#e8dcc2"
              ink="#241e15"
            />
            <ThemeSwatch
              label={copy.themes.lamplight}
              active={mounted && theme === "dark"}
              onPick={() => setTheme("dark")}
              paper="#1d1812"
              desk="#0f0c08"
              ink="#eae1cd"
            />
            <ThemeSwatch
              label={copy.themes.system}
              active={mounted && theme === "system"}
              onPick={() => setTheme("system")}
              split
              paper="#f7f1e3"
              desk="#e8dcc2"
              ink="#241e15"
            />
          </div>
        </section>

        <section aria-label={copy.settings.calendar.heading}>
          <h2 className="voice-label border-b border-rule pb-1.5">{copy.settings.calendar.heading}</h2>
          <div className="mt-4 flex items-center justify-between gap-6">
            <p className="font-serif text-[0.98rem]">{copy.settings.calendar.startWeek}</p>
            <WeekStartChoice
              value={settings.weekStart}
              onChange={(v) => updateSettings({ weekStart: v })}
            />
          </div>
        </section>
        </div>
      ) : (
        <div
          role="tabpanel"
          id="settings-panel-account"
          aria-labelledby="settings-tab-account"
          className="space-y-10"
        >
        <AccountSection />
        {user && <EncryptionSection email={user.email} />}
        {user && <BackupSection />}

        <section aria-label={copy.settings.data.heading}>
          <h2 className="voice-label border-b border-rule pb-1.5">{copy.settings.data.heading}</h2>
          <p className="voice-prose mt-4 text-[0.9rem] text-ink-soft">
            {copy.settings.data.lead}
            {stats && stats.total > 0 && (
              <> {copy.settings.data.countSoFar(stats.total)}</>
            )}{" "}
            {copy.settings.data.takeCopy}
          </p>
          {/* JSON and its restore sit together — they're the same round-trip
              archive; Markdown (the read-elsewhere copy) trails */}
          <div className="mt-4 flex flex-wrap gap-2">
            <PaperButton onClick={() => void exportJSON()}>
              {copy.settings.data.exportJSON}
            </PaperButton>
            <PaperButton onClick={() => fileRef.current?.click()}>
              {copy.settings.data.restore}
            </PaperButton>
            <PaperButton onClick={() => void exportMarkdown()}>
              {copy.settings.data.exportMarkdown}
            </PaperButton>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void onImport(file);
                e.target.value = "";
              }}
            />
          </div>
          <StorageLine signedIn={!!user} />
        </section>

        <DangerZone user={user} />
        </div>
      )}
    </PageBackHeader>
  );
}

/**
 * The danger zone — every irreversible action, fenced behind a red
 * hairline (the today zone's blue outline, in ember) and each held to
 * confirm. Erase is always here; delete-account joins it when signed
 * in. Each carries its own description so the two can't be confused.
 */
function DangerZone({ user }: { user: { email: string } | null }) {
  const doErase = async () => {
    await eraseAll();
    toast(copy.settings.toasts.erased);
  };
  const doDelete = async () => {
    try {
      const response = await fetch("/api/account/delete", { method: "POST" });
      if (!response.ok) throw new Error(`delete ${response.status}`);
    } catch {
      toast(copy.settings.account.deleteAccount.failed);
      return;
    }
    await releaseBinding().catch(() => {});
    await authClient.signOut().catch(() => {});
    toast(copy.settings.account.deleteAccount.done);
  };

  return (
    <section aria-label={copy.settings.danger.heading}>
      <div className="rounded-2xl border border-ember/45 p-5 sm:p-6">
        <h2 className="voice-label text-ember">{copy.settings.danger.heading}</h2>
        <div className="mt-5 space-y-6">
          <DangerAction
            title={copy.settings.danger.eraseTitle}
            description={
              user
                ? copy.settings.danger.eraseDescSynced
                : copy.settings.danger.eraseDesc
            }
            hold={copy.settings.danger.eraseHold}
            onComplete={doErase}
          />
          {user && (
            <DangerAction
              title={copy.settings.danger.deleteTitle}
              description={copy.settings.danger.deleteDesc}
              hold={copy.settings.danger.deleteHold}
              onComplete={doDelete}
            />
          )}
        </div>
      </div>
    </section>
  );
}

/** One fenced destructive action: what it does, and a held confirm. */
function DangerAction({
  title,
  description,
  hold,
  onComplete,
}: {
  title: string;
  description: string;
  hold: string;
  onComplete: () => void | Promise<void>;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="font-serif text-[0.98rem] text-ink">{title}</p>
        <p className="voice-prose mt-0.5 text-[0.9rem] text-ink-soft">
          {description}
        </p>
      </div>
      <HoldToErase label={hold} onComplete={() => void onComplete()} />
    </div>
  );
}

/**
 * The sync trust lines. One quiet sentence for state, and beneath it
 * the integrity count — device vs server — in the data voice. When
 * the two disagree beyond what's still in flight, a reconcile action
 * appears (rewind the cursor, re-walk the feed; always safe).
 */
function SyncLines() {
  const sync = useSyncStatus();
  const online = useOnline();

  // Only meaningful when we can actually compare against the server — and
  // never while locked: there the counts are EXPECTED to disagree (the
  // sealed entries can't come down until the device unlocks), the paused
  // row already explains it, and reconcile's re-walk couldn't run anyway
  // (the cycle bails while locked), so the button would be a dead end.
  const outOfStep =
    online &&
    !sync.locked &&
    sync.localCount !== null &&
    sync.serverCount !== null &&
    Math.abs(sync.localCount - sync.serverCount) > sync.pendingCount;

  return (
    <div className="mt-3 space-y-1.5">
      {/* the integrity counts (device · server) now ride the Synced readout
          line itself, so there's no separate count line beneath */}
      <ProtRow glyph={<SyncGlyph />} {...syncRow(sync, online)} />
      {sync.skewed && (
        <p className="voice-prose text-[0.9rem] text-ink-faint">
          {copy.settings.sync.skewed}
        </p>
      )}
      {outOfStep && (
        // the house pattern for actions: the state, then what pressing the
        // button will actually do, then the button (see turnOffHint)
        <div className="pt-1">
          <p className="voice-prose text-[0.9rem] text-ember">
            {copy.settings.sync.outOfStep}
          </p>
          <p className="voice-prose mt-1 max-w-[46ch] text-[0.9rem] text-ink-faint">
            {copy.settings.sync.reconcileHint}
          </p>
          <div className="mt-3">
            <PaperButton onClick={() => void reconcile()}>
              {copy.settings.sync.reconcile}
            </PaperButton>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One quiet data-voice line on device storage: persistent or
 * best-effort, and the room left. Best-effort earns a hint — eviction
 * is the one silent loss the device itself can inflict.
 */
function StorageLine({ signedIn }: { signedIn: boolean }) {
  const storage = useStorageHealth();
  if (storage.usageBytes === null || storage.quotaBytes === null) return null;
  // the quantities in the data voice; the guarantee — and the concrete
  // circumstance under which it can break — spelled out in prose
  const note =
    storage.persisted === true
      ? copy.settings.data.storageKept
      : signedIn
        ? copy.settings.data.storageEvictableSignedIn
        : copy.settings.data.storageEvictableSignedOut;
  return (
    <div className="mt-4 space-y-1">
      <p className="voice-data text-ink-faint">
        {copy.settings.data.storageLine(
          formatBytes(storage.usageBytes),
          formatBytes(storage.quotaBytes),
        )}
      </p>
      <p className="voice-prose max-w-[46ch] text-[0.9rem] text-ink-faint">
        {note}
      </p>
    </div>
  );
}

/** Feather-style eye / eye-off, in the account menu's glyph language. */
function EyeToggle({
  shown,
  onToggle,
}: {
  shown: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      // pointer-down + preventDefault so tapping the eye never steals focus
      // (and the keyboard) from the field
      onMouseDown={(e) => e.preventDefault()}
      onClick={onToggle}
      aria-label={shown ? "Hide passphrase" : "Show passphrase"}
      aria-pressed={shown}
      className="pressable absolute right-1.5 top-1/2 -translate-y-1/2 rounded-[5px] p-1.5 text-ink-faint hover:text-ink-soft"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        width="18"
        height="18"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {shown ? (
          <>
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </>
        ) : (
          <>
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </>
        )}
      </svg>
    </button>
  );
}

/** Passphrase strength — four bars, ember-weak climbing to green-strong. */
function StrengthMeter({ score, label }: { score: number; label: string }) {
  const filled = Math.min(4, Math.max(1, score));
  const tone =
    score <= 1
      ? "--strength-weak"
      : score === 2
        ? "--strength-fair"
        : score === 3
          ? "--strength-good"
          : "--strength-strong";
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1.5" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className="h-1 flex-1 rounded-full transition-colors duration-200"
            style={{
              backgroundColor: `var(${i < filled ? tone : "--strength-track"})`,
            }}
          />
        ))}
      </div>
      <p className="voice-prose text-[0.8rem] text-ink-faint">{label}</p>
    </div>
  );
}

/**
 * End-to-end encryption. Three states: not yet sealed (offer it),
 * sealed and this device holds the key (one quiet line), sealed and
 * locked (the unlock form — sync waits on it, capture never does).
 * Enrollment shows the recovery code exactly once, with the recovery-
 * file download; the code is not reconstructable afterward.
 */
function EncryptionSection({ email }: { email: string }) {
  const sync = useSyncStatus();
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [secret, setSecret] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [strength, setStrength] = useState<PassphraseStrength | null>(null);
  const [showPass, setShowPass] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // nudge a focused field above the keyboard, within the now-scrollable
  // dialog — 'center' keeps it comfortably in view without ever pushing a
  // field that's already visible out of the way
  const revealOnFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    const el = e.currentTarget;
    setTimeout(() => el.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
  };

  useEffect(() => {
    void refreshEnrollment().then((e) => setEnrolled(e === "unknown" ? null : e));
    void getBookKey().then((k) => setHasKey(!!k));
  }, [sync.locked]);

  // arriving from the post-sign-in offer (/welcome → "Set up encryption"):
  // open the enroll dialog straight away, once we know the account isn't
  // already sealed. Clean the query so a refresh doesn't reopen it.
  const [wantSeal] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("seal") === "1",
  );
  useEffect(() => {
    if (wantSeal && enrolled === false) {
      window.history.replaceState(null, "", "/settings");
      setEnrollOpen(true);
    }
  }, [wantSeal, enrolled]);

  // arriving from the calendar's locked letter ("Unlock in Settings"):
  // bring the unlock form into view once it's actually the section's body.
  // Clean only the unlock param — the tab must survive a refresh.
  const sectionRef = useRef<HTMLElement>(null);
  const [wantUnlock] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("unlock") === "1",
  );
  useEffect(() => {
    if (!wantUnlock || !enrolled || hasKey !== false) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("unlock");
    window.history.replaceState(null, "", url);
    sectionRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [wantUnlock, enrolled, hasKey]);

  // the things a guesser tries first: the account's email and its local part
  const guessHints = useMemo(
    () => [email, email.split("@")[0], "snippets"].filter(Boolean),
    [email],
  );

  // quiet live strength read; the dynamic zxcvbn import is memoized so
  // only the first keystroke pays for it
  useEffect(() => {
    if (!pass) {
      setStrength(null);
      return;
    }
    let alive = true;
    void checkPassphrase(pass, guessHints).then((s) => {
      if (alive) setStrength(s);
    });
    return () => {
      alive = false;
    };
  }, [pass, guessHints]);

  const doEnroll = async () => {
    if (pass.length < 10) {
      setError(copy.settings.encryption.tooShort);
      return;
    }
    if (pass !== confirm) {
      setError(copy.settings.encryption.mismatch);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // the passphrase is the weakest link once its wrapped copy rests
      // on the server — refuse a guessable one rather than seal behind it
      const graded = await checkPassphrase(pass, guessHints);
      if (!graded.ok) {
        setError(copy.settings.encryption.tooWeak);
        setBusy(false);
        return;
      }
      const code = await enroll(pass);
      setPass("");
      setConfirm("");
      setEnrollOpen(false);
      setRecoveryCode(code);
      setEnrolled(true);
      setHasKey(true);
      requestSync();
    } catch {
      setError(copy.settings.encryption.enrollFailed);
    }
    setBusy(false);
  };

  const doUnlock = async () => {
    setBusy(true);
    setError(null);
    try {
      await unlock(secret, recoveryMode ? "recovery" : "passphrase");
      setSecret("");
      setHasKey(true);
      requestSync();
    } catch {
      setError(copy.settings.encryption.wrongSecret);
    }
    setBusy(false);
  };

  const downloadKit = () => {
    if (!recoveryCode) return;
    const blob = new Blob([recoveryKitText(recoveryCode, email)], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "snippets-recovery-code.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  let body: React.ReactNode;
  if (enrolled === null) body = null;
  else if (!enrolled) {
    body = (
      <>
        <div className="mt-4">
          <ProtRow
            glyph={<ShieldGlyph />}
            word={copy.settings.protection.notEncrypted}
            sub=""
            state="off"
          />
        </div>
        <p className="voice-prose mt-4 text-[0.9rem] text-ink-soft">
          {copy.settings.encryption.offLead}
        </p>
        <div className="mt-4">
          <PaperButton onClick={() => setEnrollOpen(true)}>
            {copy.settings.encryption.turnOn}
          </PaperButton>
        </div>
      </>
    );
  } else if (hasKey) {
    body = (
      <div className="mt-4">
        <ProtRow
          glyph={<ShieldGlyph />}
          word={copy.settings.protection.encrypted}
          sub={copy.settings.protection.encryptedSub}
          state="good"
        />
        <div className="mt-4 flex flex-col gap-3">
          <div>
            <p className="font-serif text-[0.98rem] text-ink">
              {copy.settings.encryption.turnOff}
            </p>
            <p className="voice-prose mt-0.5 text-[0.9rem] text-ink-soft">
              {copy.settings.encryption.turnOffHint}
            </p>
          </div>
          <HoldToErase
            // outline, not the solid ember of erase/delete: turning
            // encryption off is grave but loses nothing
            variant="outline"
            label={copy.settings.encryption.turnOffHold}
            onComplete={() => {
              void (async () => {
                try {
                  await disableEncryption();
                  setHasKey(false);
                  setEnrolled(false);
                } catch {
                  setError(copy.settings.encryption.turnOffFailed);
                }
              })();
            }}
          />
        </div>
      </div>
    );
  } else {
    body = (
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void doUnlock();
        }}
      >
        <ProtRow
          glyph={<ShieldGlyph />}
          word={copy.settings.protection.locked}
          sub={copy.settings.protection.lockedSub}
          state="attention"
        />
        <div className="mt-3 flex max-w-[26rem] items-stretch gap-2">
          <Input
            type={recoveryMode ? "text" : "password"}
            autoComplete="current-password"
            aria-label={
              recoveryMode
                ? copy.settings.encryption.recoveryLabel
                : copy.settings.encryption.unlockLabel
            }
            placeholder={
              recoveryMode
                ? copy.settings.encryption.recoveryLabel
                : copy.settings.encryption.unlockLabel
            }
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="h-10 flex-1 font-serif text-[1rem]"
          />
          <PaperButton
            type="submit"
            disabled={busy || secret.length === 0}
            className="inline-flex h-10 shrink-0 items-center justify-center"
          >
            {busy
              ? copy.settings.encryption.unlocking
              : copy.settings.encryption.unlock}
          </PaperButton>
        </div>
        <button
          type="button"
          className="pressable mt-2 rounded-[5px] font-serif text-[0.9rem] text-ink-faint hover:text-ink-soft"
          onClick={() => {
            setRecoveryMode((v) => !v);
            setError(null);
          }}
        >
          {recoveryMode
            ? copy.settings.encryption.usePassphrase
            : copy.settings.encryption.useRecovery}
        </button>
      </form>
    );
  }

  return (
    <section ref={sectionRef} aria-label={copy.settings.encryption.heading}>
      <h2 className="voice-label border-b border-rule pb-1.5">
        {copy.settings.encryption.heading}
      </h2>
      {body}
      {error && (
        <p role="alert" className="voice-prose mt-3 text-[0.9rem] text-ember">
          {error}
        </p>
      )}

      {/* enrollment: choose the passphrase */}
      <Dialog open={enrollOpen} onOpenChange={setEnrollOpen}>
        <DialogContent className="float border-none bg-paper-raised sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="voice-display text-left text-lg">
              {copy.settings.encryption.enrollTitle}
            </DialogTitle>
            <DialogDescription className="voice-prose text-left text-[0.92rem] text-ink-soft">
              {copy.settings.encryption.enrollBody}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void doEnroll();
            }}
          >
            <label className="voice-label block text-[0.75rem]" htmlFor="e2e-pass">
              {copy.settings.encryption.passphraseLabel}
            </label>
            <div className="relative">
              <Input
                id="e2e-pass"
                type={showPass ? "text" : "password"}
                autoComplete="new-password"
                placeholder={copy.settings.encryption.passphrasePlaceholder}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                onFocus={revealOnFocus}
                className="h-10 pr-11 font-serif text-[1rem]"
              />
              <EyeToggle shown={showPass} onToggle={() => setShowPass((v) => !v)} />
            </div>
            {pass.length > 0 && strength && (
              <StrengthMeter
                score={strength.score}
                label={
                  strength.score >= 4
                    ? copy.settings.encryption.strengthStrong
                    : strength.ok
                      ? copy.settings.encryption.strengthOk
                      : copy.settings.encryption.strengthWeak
                }
              />
            )}
            <label className="voice-label block text-[0.75rem]" htmlFor="e2e-confirm">
              {copy.settings.encryption.passphraseConfirmLabel}
            </label>
            <Input
              id="e2e-confirm"
              type={showPass ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              onFocus={revealOnFocus}
              className="h-10 font-serif text-[1rem]"
            />
            {error && (
              <p role="alert" className="voice-prose text-[0.9rem] text-ember">
                {error}
              </p>
            )}
            <DialogFooter className="gap-2">
              <Button
                variant="ghost"
                type="button"
                className="font-serif"
                onClick={() => setEnrollOpen(false)}
              >
                {copy.settings.erase.cancel}
              </Button>
              <PaperButton type="submit" disabled={busy}>
                {busy
                  ? copy.settings.encryption.enrolling
                  : copy.settings.encryption.enrollConfirm}
              </PaperButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* the recovery code — shown exactly once */}
      <Dialog
        open={recoveryCode !== null}
        onOpenChange={(open) => {
          if (!open) setRecoveryCode(null);
        }}
      >
        <DialogContent className="float border-none bg-paper-raised sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="voice-display text-left text-lg">
              {copy.settings.encryption.recoveryTitle}
            </DialogTitle>
            <DialogDescription className="voice-prose text-left text-[0.92rem] text-ink-soft">
              {copy.settings.encryption.recoveryBody}
            </DialogDescription>
          </DialogHeader>
          <p className="voice-data select-all break-all text-center text-[1.05rem] leading-relaxed">
            {recoveryCode}
          </p>
          <p className="voice-prose text-center text-[0.8rem] text-ink-faint">
            {copy.settings.encryption.recoveryFileNote}
          </p>
          <DialogFooter className="gap-2">
            <PaperButton onClick={downloadKit}>
              {copy.settings.encryption.downloadKit}
            </PaperButton>
            <Button
              variant="ghost"
              className="font-serif"
              onClick={() => setRecoveryCode(null)}
            >
              {copy.settings.encryption.recoveryDone}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * The backup section — the standing arrangement with the writer's own
 * Drive. Connect is a separate, single Google consent (the drive.file
 * scope only); after that the freshness line carries the trust: when
 * the last delivery landed, or that deliveries are failing and how to
 * mend it. Never silent.
 */
function BackupSection() {
  const sync = useSyncStatus();
  const backup = sync.backup;
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // whether THIS device holds the delivery token — when it doesn't, the
  // freshness line gains a quiet "deliveries run from the device where
  // Drive was connected", so a phone-only writer isn't left assuming
  // deliveries follow them
  const [deviceHasToken, setDeviceHasToken] = useState<boolean | null>(null);
  useEffect(() => {
    void hasDriveToken()
      .then(setDeviceHasToken)
      .catch(() => setDeviceHasToken(null));
  }, [backup?.state, backup?.lastSuccessAt]);

  // returning from the Google consent: finalize server-side, then let
  // the status refresh carry the freshness line
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("drive") !== "connected") return;
    window.history.replaceState(null, "", "/settings");
    void (async () => {
      setConnecting(true);
      try {
        const response = await fetch("/api/backup/connect", { method: "POST" });
        if (response.status === 409) {
          setError(copy.settings.backup.scopeDeclined);
          return;
        }
        if (!response.ok) {
          setError(copy.settings.backup.connectFailed);
          return;
        }
        // this device adopts the token (the server forgets it) and runs
        // the first delivery itself — the freshness line is never blank
        const adopted = await adoptDriveToken();
        if (adopted === "adopted") await deliverBackup();
      } catch {
        setError(copy.settings.backup.connectFailed);
      } finally {
        setConnecting(false);
        requestSync();
      }
    })();
  }, []);

  const connect = async () => {
    setConnecting(true);
    setError(null);
    try {
      await authClient.linkSocial({
        provider: "google",
        scopes: [DRIVE_SCOPE],
        callbackURL: "/settings?drive=connected",
      });
      // on success the browser navigates to Google; reaching here quietly
      // means it didn't
    } catch {
      setError(copy.settings.backup.connectFailed);
    }
    setConnecting(false);
  };

  const disconnect = async () => {
    setDisconnecting(true);
    setError(null);
    try {
      const response = await fetch("/api/backup/disconnect", { method: "POST" });
      if (!response.ok) throw new Error(`disconnect ${response.status}`);
      await forgetDriveTokens(); // this device drops its copy too
    } catch {
      setError(copy.settings.backup.disconnectFailed);
    } finally {
      setDisconnecting(false);
      requestSync(); // refresh the ledger line
    }
  };

  const connectButton = (label: string) => (
    <PaperButton onClick={() => void connect()} disabled={connecting}>
      {connecting ? copy.settings.backup.connecting : label}
    </PaperButton>
  );

  // one derivation for the whole line (pure + unit-tested in
  // backup-shared.test.ts): "failing" covers both a reported delivery
  // error and a ledger gone quiet past the stale window while the book
  // moved — the vanished-device case, which no report can reach.
  // "now" is frozen at mount: the staleness window is days, so a page
  // visit's age can't change the verdict (and render stays pure).
  const [mountedAt] = useState(() => Date.now());
  const health = backupHealth(backup, mountedAt);

  const p = copy.settings.protection;
  let statusLine: React.ReactNode;
  let action: React.ReactNode;
  if (health === "none" || health === "off") {
    // never connected, or deliberately off / grant revoked — neutral
    statusLine = (
      <ProtRow
        glyph={<FolderGlyph />}
        word={p.backupOff}
        sub={p.backupOffSub}
        state="off"
      />
    );
    action = connectButton(
      health === "off" ? copy.settings.backup.reconnect : copy.settings.backup.connect,
    );
  } else if (health === "failing") {
    // failing — a reported error, or quiet-too-long while entries pile up
    statusLine = (
      <ProtRow
        glyph={<FolderGlyph />}
        word={p.backupFailing}
        sub={
          backup?.lastSuccessAt
            ? copy.settings.backup.failingSince(
                format(new Date(backup.lastSuccessAt), "MMMM d"),
              )
            : copy.settings.backup.failingNoSuccess
        }
        state="attention"
      />
    );
    action = connectButton(copy.settings.backup.reconnect);
  } else {
    // fresh, or pending its first delivery
    statusLine = (
      <div className="space-y-3">
        <ProtRow
          glyph={<FolderGlyph />}
          word={p.backedUp}
          sub={
            health === "fresh" && backup?.lastSuccessAt
              ? p.backedUpSub(formatDelivered(backup.lastSuccessAt))
              : p.backupFirstSub
          }
          state="good"
        />
        <p className="voice-prose text-[0.9rem] text-ink-faint">
          {copy.settings.backup.mirrors}
        </p>
        {deviceHasToken === false && (
          <p className="voice-prose max-w-[46ch] text-[0.9rem] text-ink-faint">
            {copy.settings.backup.deliversElsewhere}
          </p>
        )}
      </div>
    );
    action = (
      <div className="flex flex-col gap-3">
        <div>
          <p className="font-serif text-[0.98rem] text-ink">
            {copy.settings.backup.disconnectTitle}
          </p>
          <p className="voice-prose mt-0.5 text-[0.9rem] text-ink-soft">
            {copy.settings.backup.disconnectDesc}
          </p>
        </div>
        <PaperButton onClick={() => void disconnect()} disabled={disconnecting}>
          {disconnecting
            ? copy.settings.backup.disconnecting
            : copy.settings.backup.disconnect}
        </PaperButton>
      </div>
    );
  }

  return (
    <section aria-label={copy.settings.backup.heading}>
      <h2 className="voice-label border-b border-rule pb-1.5">
        {copy.settings.backup.heading}
      </h2>
      <p className="voice-prose mt-4 text-[0.9rem] text-ink-soft">
        {copy.settings.backup.lead}
      </p>
      <div className="mt-3 space-y-3">
        {statusLine}
        {error && (
          <p role="alert" className="voice-prose text-[0.9rem] text-ember">
            {error}
          </p>
        )}
        {action && <div>{action}</div>}
      </div>
    </section>
  );
}

/** A two-way segmented choice: a raised paper chip sits in a recessed trough. */
function WeekStartChoice({
  value,
  onChange,
}: {
  value: 0 | 1;
  onChange: (v: 0 | 1) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={copy.settings.calendar.startWeek}
      className="inline-flex shrink-0 gap-0.5 rounded-[7px] bg-paper-recessed p-0.5 shadow-[inset_0_1px_2px_rgb(var(--shadow-hue)/0.1)]"
    >
      {([
        [0, copy.settings.calendar.sunday],
        [1, copy.settings.calendar.monday],
      ] as const).map(([v, label]) => {
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(v)}
            className={cn(
              "pressable rounded-[5px] px-3.5 py-1.5 font-serif text-[0.9rem]",
              active
                ? "bg-paper-raised text-ink shadow-[inset_0_1px_0_var(--press-highlight),0_1px_2px_rgb(var(--shadow-hue)/0.12)]"
                : "text-ink-faint",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** A miniature of the theme itself: the desk, the sheet, a few lines of ink. */
function ThemeSwatch({
  label,
  active,
  onPick,
  paper,
  desk,
  ink,
  split = false,
}: {
  label: string;
  active: boolean;
  onPick: () => void;
  paper: string;
  desk: string;
  ink: string;
  split?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onPick}
      className={cn(
        "pressable hover-lift group flex w-full flex-col items-center gap-1.5 rounded-[8px] p-1.5",
        active && "shadow-[0_0_0_1.5px_var(--wax)]",
      )}
    >
      <span
        className="relative grid h-16 w-full place-items-center overflow-hidden rounded-[5px] shadow-[inset_0_1px_0_rgb(255_255_255/0.25),0_1px_3px_rgb(var(--shadow-hue)/0.25)]"
        style={{ background: desk }}
        aria-hidden="true"
      >
        {split && (
          <span
            className="absolute inset-0"
            style={{
              background: "linear-gradient(115deg, transparent 50%, #0f0c08 50%)",
            }}
          />
        )}
        {/* the sheet in miniature, laid out like the today zone: date
            centred, the composer element centred (its text lines flush
            left within it), the wax seal centred beneath */}
        <span
          className="relative flex h-11 w-14 flex-col items-center justify-center gap-[3px] rounded-[2.5px] p-1.5 shadow-[0_1px_2px_rgb(0_0_0/0.18),0_3px_6px_rgb(0_0_0/0.12)]"
          style={{ background: paper }}
        >
          <span className="block h-[2.5px] w-6 rounded-full" style={{ background: ink, opacity: 0.85 }} />
          <span className="flex w-9 flex-col items-start gap-[2.5px]">
            <span className="block h-[2px] w-full rounded-full" style={{ background: ink, opacity: 0.3 }} />
            <span className="block h-[2px] w-7 rounded-full" style={{ background: ink, opacity: 0.3 }} />
          </span>
          <span
            className="mt-[1px] block size-2 rounded-full"
            style={{ background: "#2e5685" }}
          />
        </span>
      </span>
      <span
        className={cn(
          "voice-label text-[0.8rem] transition-colors duration-150",
          active ? "text-ink" : "text-ink-faint group-hover:text-ink-soft",
        )}
      >
        {label}
      </span>
    </button>
  );
}

/**
 * The account section — sign in, or the signed-in address with the
 * sync trust lines beneath it: what's waiting, when it last went
 * through, and the device-vs-server entry counts.
 */
function AccountSection() {
  const router = useRouter();
  const { user, status } = useSession();

  return (
    <section aria-label={copy.settings.account.heading}>
      <h2 className="voice-label border-b border-rule pb-1.5">
        {copy.settings.account.heading}
      </h2>
      {user ? (
        <div className="mt-4">
          <p className="font-serif text-[0.98rem]">
            {copy.settings.account.signedInAs(user.email)}
          </p>
          <SyncLines />
          <div className="mt-4 flex items-center gap-4">
            <PaperButton onClick={() => void signOut()}>
              {copy.settings.account.signOut}
            </PaperButton>
            <p className="voice-prose text-[0.9rem] text-ink-faint">
              {copy.settings.account.signOutHint}
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <p className="voice-prose text-[0.9rem] text-ink-soft">
            {copy.settings.account.signedOutLead}
          </p>
          <div className="mt-4">
            <PaperButton
              onClick={() => router.push("/signin")}
              disabled={status === "loading"}
            >
              {copy.settings.account.signIn}
            </PaperButton>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Hold to erase — slow where the writer is deciding, fast where the
 * system responds. The wax fills the button while held; release and
 * it drains back instantly. The label bends to the act (erase, delete);
 * the physics never does.
 */
/** The deliberate hold: long enough that a destructive act can't be a slip. */
const HOLD_MS = 10_000;

function HoldToErase({
  onComplete,
  label = copy.settings.erase.hold,
  variant = "fill",
}: {
  onComplete: () => void;
  label?: string;
  /**
   * Two tiers of the same physics. `fill` — solid ember — belongs to true
   * deletion alone (erase all, delete account). `outline` is the lesser
   * destructive rank for grave-but-recoverable acts (turning off
   * encryption loses no entry): an ember hairline that only fills with
   * the colour as the hold commits.
   */
  variant?: "fill" | "outline";
}) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    if (timer.current) return;
    setHolding(true);
    navigator.vibrate?.(20);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onComplete();
    }, HOLD_MS);
  };
  const cancel = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    setHolding(false);
  };
  useEffect(() => cancel, []);

  return (
    <button
      type="button"
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={cancel}
      onContextMenu={(e) => e.preventDefault()}
      // full-width so the hold fill sweeps past a covering thumb, staying visible
      className={cn(
        "relative w-full select-none overflow-hidden rounded-[5px] px-4 py-2.5 text-center font-serif text-[0.95rem]",
        variant === "fill"
          ? "bg-ember text-paper-raised shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_3px_rgb(var(--shadow-hue)/0.3)]"
          : "border border-ember/45 text-ember",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0",
          // the outline's advancing colour is a translucent wash, not the
          // solid ember — the label stays ember ink and reads over both the
          // bare paper ahead of the front and the wash behind it
          variant === "fill" ? "bg-ember-deep" : "bg-ember/15",
        )}
        style={{
          clipPath: holding ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
          transition: holding
            ? `clip-path ${HOLD_MS}ms linear`
            : "clip-path 200ms var(--ease-out)",
        }}
      />
      <span className="relative">
        {holding ? copy.settings.erase.holding : label}
      </span>
    </button>
  );
}
