"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
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
} from "@/lib/backup-client";
import { exportJSON, exportMarkdown, importJSON } from "@/lib/export";
import { updateSettings, useSettings } from "@/lib/settings";
import { useStats } from "@/hooks/use-snippets";
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
import { copy } from "@/lib/copy";
import { cn } from "@/lib/utils";

export default function SettingsPage() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  // settings opens with router.push, so back returns to wherever you came from;
  // on a cold/direct load (no in-app history) fall back to the book
  const goBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push("/calendar");
  };
  const stats = useStats();
  const { user } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);
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
    <div className="page-settle">
      <header className="mb-8">
        {/* the title is the back affordance: the same drawn guillemet as the
            schedule header sits in front of it, and pressing it returns to the
            book */}
        <button
          type="button"
          onClick={goBack}
          aria-label={copy.settings.back}
          // font-size on the button so the chevron's em scales to the "Settings"
          // text, at the same 0.58em ratio it wears against the month header
          className="pressable inline-flex items-baseline rounded-[5px] text-left text-[2.5rem] leading-[1.02] hover:text-wax sm:text-[2.9rem]"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 580.5 770.7"
            className="mr-1.5 inline-block h-[0.58em] w-auto -translate-y-[0.08em] text-ink-faint"
            fill="currentColor"
          >
            <path d="M2.5 361.7Q9.2 341.0 29.6 323.6Q50.0 306.3 93.9 280.9Q194.1 222.2 270.3 175.3Q346.5 128.4 404.2 89.6Q461.8 50.7 505.6 17.8Q526.6 4.1 545.6 0.8Q564.5 -2.5 573.8 7.3Q584.0 18.1 578.7 33.0Q573.3 47.9 557.4 66.6Q528.7 98.6 492.7 135.8Q456.7 172.9 412.8 215.7Q369.0 258.5 316.2 308.1Q263.3 357.6 200.6 414.5L209.2 350.7Q254.5 428.8 286.1 494.0Q317.6 559.3 339.9 613.0Q362.2 666.7 378.3 711.2Q384.8 727.5 382.6 742.0Q380.5 756.4 367.8 764.6Q353.6 773.3 339.9 769.5Q326.2 765.8 313.8 751.2Q286.3 712.3 249.6 665.8Q212.9 619.3 162.8 564.8Q112.7 510.4 43.4 448.7Q14.2 421.7 5.3 402.8Q-3.6 383.8 2.5 361.7Z" />
          </svg>
          <h1 className="voice-display leading-[1.02]">
            {copy.settings.title}
          </h1>
        </button>
      </header>

      <div className="space-y-10">
        <AccountSection />
        {user && <EncryptionSection email={user.email} />}
        {user && <BackupSection />}

        <section aria-label={copy.settings.appearance.heading}>
          <h2 className="voice-label border-b border-rule pb-1.5">{copy.settings.appearance.heading}</h2>
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

        <section aria-label={copy.settings.data.heading}>
          <h2 className="voice-label border-b border-rule pb-1.5">{copy.settings.data.heading}</h2>
          <p className="voice-prose mt-4 max-w-[46ch] text-[0.9rem] text-ink-soft">
            {copy.settings.data.lead}
            {stats && stats.total > 0 && (
              <> {copy.settings.data.countSoFar(stats.total)}</>
            )}{" "}
            {copy.settings.data.takeCopy}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <PaperButton onClick={() => void exportJSON()}>
              {copy.settings.data.exportJSON}
            </PaperButton>
            <PaperButton onClick={() => void exportMarkdown()}>
              {copy.settings.data.exportMarkdown}
            </PaperButton>
            <PaperButton onClick={() => fileRef.current?.click()}>
              {copy.settings.data.restore}
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
    </div>
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
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="max-w-[42ch]">
        <p className="font-serif text-[0.98rem] text-ink">{title}</p>
        <p className="voice-prose mt-0.5 text-[0.9rem] text-ink-soft">
          {description}
        </p>
      </div>
      <div className="shrink-0">
        <HoldToErase label={hold} onComplete={() => void onComplete()} />
      </div>
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

  let line: string;
  if (sync.locked) line = copy.settings.sync.locked;
  else if (sync.phase === "offline") line = copy.settings.sync.offline;
  else if (sync.phase === "error") line = copy.settings.sync.error;
  else if (sync.phase === "syncing") line = copy.settings.sync.syncing;
  else if (sync.pendingCount > 0)
    line = copy.settings.sync.pending(sync.pendingCount);
  else if (sync.lastSyncedAt === null) line = copy.settings.sync.neverSynced;
  else
    line = copy.settings.sync.syncedAt(
      format(
        sync.lastSyncedAt,
        isToday(sync.lastSyncedAt) ? "h:mm a" : "MMM d",
      ),
    );

  const outOfStep =
    sync.localCount !== null &&
    sync.serverCount !== null &&
    Math.abs(sync.localCount - sync.serverCount) > sync.pendingCount;

  return (
    <div className="mt-2 space-y-1.5">
      <p className="voice-prose text-[0.9rem] text-ink-soft">{line}</p>
      {sync.skewed && (
        <p className="voice-prose text-[0.9rem] text-ink-faint">
          {copy.settings.sync.skewed}
        </p>
      )}
      {sync.localCount !== null && sync.serverCount !== null && (
        <p className="voice-data text-ink-faint">
          {copy.settings.sync.counts(
            sync.localCount.toLocaleString(),
            sync.serverCount.toLocaleString(),
          )}
        </p>
      )}
      {outOfStep && (
        <p className="voice-prose text-[0.9rem] text-ember">
          {copy.settings.sync.outOfStep}{" "}
          <button
            type="button"
            onClick={() => void reconcile()}
            className="pressable rounded-[3px] underline decoration-ember/40 underline-offset-2 hover:decoration-ember"
          >
            {copy.settings.sync.reconcile}
          </button>
        </p>
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
  const line =
    storage.persisted === true
      ? copy.settings.data.storagePersistent(
          formatBytes(storage.usageBytes),
          formatBytes(storage.quotaBytes),
        )
      : copy.settings.data.storageBestEffort(
          formatBytes(storage.usageBytes),
          formatBytes(storage.quotaBytes),
        );
  return (
    <div className="mt-4 space-y-1">
      <p className="voice-data text-ink-faint">{line}</p>
      {storage.persisted !== true && !signedIn && (
        <p className="voice-prose max-w-[46ch] text-[0.9rem] text-ink-faint">
          {copy.settings.data.storageEvictionHint}
        </p>
      )}
    </div>
  );
}

/**
 * End-to-end encryption. Three states: not yet sealed (offer it),
 * sealed and this device holds the key (one quiet line), sealed and
 * locked (the unlock form — sync waits on it, capture never does).
 * Enrollment shows the recovery code exactly once, with the kit
 * download; the code is not reconstructable afterward.
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    a.download = "snippets-recovery-kit.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  let body: React.ReactNode;
  if (enrolled === null) body = null;
  else if (!enrolled) {
    body = (
      <>
        <p className="voice-prose mt-4 max-w-[46ch] text-[0.9rem] text-ink-soft">
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
        <p className="voice-prose max-w-[46ch] text-[0.9rem] text-ink-soft">
          {copy.settings.encryption.onLead}
        </p>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p className="voice-prose max-w-[40ch] text-[0.9rem] text-ink-faint">
            {copy.settings.encryption.turnOffHint}
          </p>
          <div className="shrink-0">
            <HoldToErase
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
        <p className="voice-prose max-w-[46ch] text-[0.9rem] text-ink-soft">
          {copy.settings.encryption.lockedLead}
        </p>
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
    <section aria-label={copy.settings.encryption.heading}>
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
            <Input
              id="e2e-pass"
              type="password"
              autoComplete="new-password"
              placeholder={copy.settings.encryption.passphrasePlaceholder}
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              className="h-10 font-serif text-[1rem]"
            />
            {pass.length > 0 && strength && (
              <p className="voice-prose text-[0.85rem] text-ink-faint">
                {strength.score >= 4
                  ? copy.settings.encryption.strengthStrong
                  : strength.ok
                    ? copy.settings.encryption.strengthOk
                    : copy.settings.encryption.strengthWeak}
              </p>
            )}
            <label className="voice-label block text-[0.75rem]" htmlFor="e2e-confirm">
              {copy.settings.encryption.passphraseConfirmLabel}
            </label>
            <Input
              id="e2e-confirm"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
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
        if (adopted) await deliverBackup();
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

  const deliveredWhen = (iso: string) => {
    const at = new Date(iso);
    if (isToday(at)) return format(at, "h:mm a");
    if (isYesterday(at)) return `yesterday, ${format(at, "h:mm a")}`;
    return format(at, "MMMM d");
  };

  const connectButton = (label: string) => (
    <PaperButton onClick={() => void connect()} disabled={connecting}>
      {connecting ? copy.settings.backup.connecting : label}
    </PaperButton>
  );

  let statusLine: React.ReactNode = null;
  let action: React.ReactNode = null;
  if (!backup) {
    action = connectButton(copy.settings.backup.connect);
  } else if (backup.state === "active") {
    statusLine = (
      <div className="space-y-1">
        <p className="voice-prose text-[0.9rem] text-ink-soft">
          {backup.lastSuccessAt
            ? copy.settings.backup.lastDelivered(
                deliveredWhen(backup.lastSuccessAt),
              )
            : copy.settings.backup.firstOnItsWay}
        </p>
        <p className="voice-prose max-w-[46ch] text-[0.9rem] text-ink-faint">
          {copy.settings.backup.mirrors}
        </p>
      </div>
    );
    action = (
      <PaperButton onClick={() => void disconnect()} disabled={disconnecting}>
        {disconnecting
          ? copy.settings.backup.disconnecting
          : copy.settings.backup.disconnect}
      </PaperButton>
    );
  } else if (backup.state === "error") {
    // failing but still trying — ember, and offer a reconnect
    statusLine = (
      <p className="voice-prose text-[0.9rem] text-ember">
        {backup.lastSuccessAt
          ? copy.settings.backup.failingSince(
              format(new Date(backup.lastSuccessAt), "MMMM d"),
            )
          : copy.settings.backup.failingNoSuccess}
      </p>
    );
    action = connectButton(copy.settings.backup.reconnect);
  } else {
    // deliberately off (disconnected, or the grant was revoked) — neutral
    statusLine = (
      <p className="voice-prose text-[0.9rem] text-ink-soft">
        {copy.settings.backup.off}
      </p>
    );
    action = connectButton(copy.settings.backup.reconnect);
  }

  return (
    <section aria-label={copy.settings.backup.heading}>
      <h2 className="voice-label border-b border-rule pb-1.5">
        {copy.settings.backup.heading}
      </h2>
      <p className="voice-prose mt-4 max-w-[46ch] text-[0.9rem] text-ink-soft">
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
          <p className="voice-prose max-w-[46ch] text-[0.9rem] text-ink-soft">
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
function HoldToErase({
  onComplete,
  label = copy.settings.erase.hold,
}: {
  onComplete: () => void;
  label?: string;
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
    }, 1400);
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
      className="relative select-none overflow-hidden rounded-[5px] bg-ember px-4 py-2 font-serif text-[0.95rem] text-paper-raised shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_1px_3px_rgb(var(--shadow-hue)/0.3)]"
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 bg-ember-deep"
        style={{
          clipPath: holding ? "inset(0 0 0 0)" : "inset(0 100% 0 0)",
          transition: holding
            ? "clip-path 1.4s linear"
            : "clip-path 200ms var(--ease-out)",
        }}
      />
      <span className="relative">
        {holding ? copy.settings.erase.holding : label}
      </span>
    </button>
  );
}
