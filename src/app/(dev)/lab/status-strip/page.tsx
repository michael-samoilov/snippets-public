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
function CloudIcon() {
  return (
    <svg {...iconProps}>
      <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z" />
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
      <span className="mt-[0.35em] size-[7px] shrink-0 rounded-full border border-ink-faint" />
    );
  return (
    <span
      className={`mt-[0.35em] size-[7px] shrink-0 rounded-full ${
        state === "attention" ? "bg-ember" : "bg-wax"
      }`}
    />
  );
}

function Row({
  mark,
  word,
  state,
  sub,
  mono,
}: {
  mark: React.ReactNode;
  word: string;
  state: State;
  sub: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-3">
      <span className={`flex shrink-0 items-baseline ${tone[state]}`}>{mark}</span>
      <div className="min-w-0">
        <span className={`voice-label text-[0.8rem] ${tone[state]}`}>{word}</span>
        <span
          className={`ml-2 ${mono ? "voice-data" : "voice-prose text-[0.9rem]"} text-ink-soft`}
        >
          {sub}
        </span>
      </div>
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
    <div className="space-y-3">
      <Row
        mark={mark(enc, <ShieldIcon />)}
        state={enc}
        word={enc === "good" ? "Encrypted" : "Not encrypted"}
        sub={
          enc === "good"
            ? "Only your devices hold the key."
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
            ? "3:12 pm · 1,204 carried"
            : sync === "attention"
              ? "Retrying — your entries are safe on this device."
              : "Sign in to carry entries across devices."
        }
      />
      <Row
        mark={mark(backup, <CloudIcon />)}
        state={backup}
        word={backup === "good" ? "Backed up" : "Backup off"}
        mono={backup === "good"}
        sub={
          backup === "good"
            ? "Delivered to your Drive · today, 6:12 am"
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

export default function StatusStripLab() {
  return (
    <main className="mx-auto max-w-[64rem] space-y-12 p-8 sm:p-12">
      <header>
        <h1 className="voice-display text-[2rem]">Status indicators</h1>
        <p className="voice-prose mt-2 max-w-[40ch] text-[0.95rem] text-ink-soft">
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
    </main>
  );
}
