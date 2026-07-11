"use client";

/**
 * PROPOSAL PROTOTYPE — status indicators for the protective features
 * (encryption / sync / backup), BACKLOG item 11. Renders the recommended
 * design in its states, plus a glyph-led variant, so the green-vs-wax and
 * dot-vs-icon decisions can be seen, not argued. Dev-only (lab).
 */

const iconProps = {
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

function ShieldIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <rect x="8.8" y="10.2" width="6.4" height="4" rx="0.95" />
      <path d="M10.1 10.2v-1.35a1.9 1.9 0 0 1 3.8 0v1.35" />
    </svg>
  );
}
function RotateIcon() {
  return (
    <svg {...iconProps}>
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10" />
    </svg>
  );
}
function FolderIcon() {
  return (
    <svg {...iconProps}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}
function HardDriveIcon() {
  return (
    <svg {...iconProps}>
      <line x1="22" y1="12" x2="2" y2="12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
      <line x1="6" y1="16" x2="6.01" y2="16" />
      <line x1="10" y1="16" x2="10.01" y2="16" />
    </svg>
  );
}
function ArchiveIcon() {
  return (
    <svg {...iconProps}>
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  );
}
function CloudIcon() {
  return (
    <svg {...iconProps}>
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
    </svg>
  );
}
// A monochrome, single-weight take on the Drive prism — recognisable only
// by its colours in reality, so stroked it reads as a plain triangle.
function DriveGlyph() {
  return (
    <svg {...iconProps}>
      <path d="M8.3 3.5 15.7 3.5 22 15 14.6 15z" />
      <path d="M8.3 3.5 2 15 5.7 21 12 9.5z" />
      <path d="M5.7 21 18.3 21 22 15 9.4 15z" />
    </svg>
  );
}

type State = "good" | "off" | "attention";

const tone: Record<State, string> = {
  good: "text-wax",
  off: "text-ink-faint",
  attention: "text-ember",
};

/** Variant A — a unified state dot (filled wax / hollow faint / ember). */
function Dot({ state }: { state: State }) {
  if (state === "off")
    return (
      <span className="size-[7px] shrink-0 rounded-full border border-ink-faint" />
    );
  return (
    <span
      className={`size-[7px] shrink-0 rounded-full ${
        state === "attention" ? "bg-ember" : "bg-wax"
      }`}
    />
  );
}

// The mark is vertically centred with the label line; the description sits
// on its own full line beneath, aligned under the label (not the mark).
function Row({
  mark,
  word,
  state,
  sub,
}: {
  mark: React.ReactNode;
  word: string;
  state: State;
  sub: string;
  mono?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1.25rem_1fr] items-center gap-x-3 gap-y-1">
      <span className={`flex justify-center ${tone[state]}`}>{mark}</span>
      <span className={`voice-label text-[0.8rem] ${tone[state]}`}>{word}</span>
      <p className="col-start-2 voice-data text-ink-soft">
        {sub}
      </p>
    </div>
  );
}

function Strip({
  variant,
  scenario,
}: {
  variant: "dot" | "glyph";
  scenario: "allGood" | "mixed" | "allOff";
}) {
  const enc: State =
    scenario === "allGood" ? "good" : scenario === "mixed" ? "good" : "off";
  const sync: State =
    scenario === "allGood" ? "good" : scenario === "mixed" ? "attention" : "off";
  const backup: State =
    scenario === "allGood" ? "good" : scenario === "mixed" ? "off" : "off";

  const mark = (state: State, glyph: React.ReactNode) =>
    variant === "glyph" ? glyph : <Dot state={state} />;

  return (
    <div className="space-y-4">
      <Row
        mark={mark(enc, <ShieldIcon />)}
        state={enc}
        word={enc === "good" ? "Encrypted" : "Not encrypted"}
        sub={
          enc === "good"
            ? "Even we can’t see your entries — only your devices hold the key."
            : "Turn on to seal entries end-to-end."
        }
      />
      <Row
        mark={mark(sync, <RotateIcon />)}
        state={sync}
        word={
          sync === "good" ? "Synced" : sync === "attention" ? "Sync snag" : "Sync off"
        }
        mono={sync === "good"}
        sub={
          sync === "good"
            ? "3:12 pm · 1,204 locally on this device · 1,204 on the server"
            : sync === "attention"
              ? "Retrying — your entries are safe on this device."
              : "Sign in to carry entries across devices."
        }
      />
      <Row
        mark={mark(backup, <FolderIcon />)}
        state={backup}
        word={backup === "good" ? "Backed up" : "Backup off"}
        mono={backup === "good"}
        sub={
          backup === "good"
            ? "Sent to your Drive · today, 6:12 am"
            : "Connect Google Drive for a readable copy."
        }
      />
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="max-w-[30rem]">
      <h2 className="voice-label border-b border-rule pb-1.5 text-ink-faint">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const BACKUP_OPTIONS: { label: string; glyph: React.ReactNode }[] = [
  { label: "folder", glyph: <FolderIcon /> },
  { label: "hard-drive", glyph: <HardDriveIcon /> },
  { label: "archive", glyph: <ArchiveIcon /> },
  { label: "drive prism (mono)", glyph: <DriveGlyph /> },
  { label: "cloud (reads as sync)", glyph: <CloudIcon /> },
];

export default function StatusStripLab() {
  return (
    <main className="mx-auto max-w-[64rem] space-y-12 p-8 sm:p-12">
      <header>
        <h1 className="voice-display text-[2rem]">Status indicators</h1>
        <p className="voice-prose mt-2 max-w-[42ch] text-[0.95rem] text-ink-soft">
          Proposal for BACKLOG 11 — a quiet confidence strip for the top of
          the Account tab. Wax = live &amp; good, ember = needs attention,
          ink-faint = off. No new green.
        </p>
      </header>

      <div className="grid gap-x-12 gap-y-10 sm:grid-cols-2">
        <Panel title="A · dot — all on">
          <Strip variant="dot" scenario="allGood" />
        </Panel>
        <Panel title="B · glyph — all on">
          <Strip variant="glyph" scenario="allGood" />
        </Panel>
        <Panel title="A · dot — mixed">
          <Strip variant="dot" scenario="mixed" />
        </Panel>
        <Panel title="B · glyph — mixed">
          <Strip variant="glyph" scenario="mixed" />
        </Panel>
        <Panel title="A · dot — signed out / off">
          <Strip variant="dot" scenario="allOff" />
        </Panel>
        <Panel title="B · glyph — signed out / off">
          <Strip variant="glyph" scenario="allOff" />
        </Panel>
      </div>

      <Panel title="Backup glyph — options">
        <p className="voice-prose mb-4 max-w-[36ch] text-[0.85rem] text-ink-faint">
          The metaphor should say &ldquo;a stored copy,&rdquo; not
          &ldquo;cloud&rdquo; (which reads as sync). All in the sanctioned
          Feather stroke, wax-toned.
        </p>
        <ul className="space-y-3">
          {BACKUP_OPTIONS.map((o) => (
            <li key={o.label} className="flex items-center gap-3 text-wax">
              <span className="flex w-5 justify-center">{o.glyph}</span>
              <span className="voice-data text-ink-soft">{o.label}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </main>
  );
}
