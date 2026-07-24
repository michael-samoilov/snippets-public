import { Em } from "@/components/prose";
import { activeSpeechProviders } from "@/lib/speech-providers";

/**
 * The structured pieces of the policy pages that aren't plain prose —
 * dropped into the `.mdx` as simple tags so the author edits Markdown
 * everywhere else. Presentational and server-only (no interactivity);
 * `Providers`/`ProviderRow` read the configured speech providers so the
 * pages name only the services this deployment actually uses.
 *
 * Authoring note: Markdown works *inside* these tags too —
 * `<Flow label="…">plain text with **bold**</Flow>`.
 */

/** The glance band at the top of the privacy page — wraps the Flow rows. */
export function Flows({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5 border-y border-rule-faint py-6">{children}</div>
  );
}

/** One glance row: a small-caps label rail, then a plain sentence. */
export function Flow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[7.5rem_1fr] sm:gap-x-6">
      <p className="voice-label-sm text-ink-soft sm:pt-0.5">{label}</p>
      <p className="voice-prose-sm">{children}</p>
    </div>
  );
}

/** The privacy page's voice-provider list — the lead line + the named
 *  services, shown only when a provider is actually configured. */
export function Providers() {
  const providers = activeSpeechProviders();
  if (providers.length === 0) return null;
  return (
    <>
      <p className="voice-prose-sm">
        The services, in the order the app tries them:
      </p>
      <ul className="ml-4 list-disc space-y-1.5">
        {providers.map((p) => (
          <li key={p.name} className="voice-prose-sm">
            <a
              href={p.privacyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              {p.label}
            </a>
            {": "}
            {p.retentionLine}
          </li>
        ))}
      </ul>
    </>
  );
}

/** A numbered test's steps — the ordered list wrapper. */
export function Steps({ children }: { children: React.ReactNode }) {
  return <ol className="space-y-2">{children}</ol>;
}

/** One step: a hanging mono number, then the instruction. */
export function Step({
  n,
  children,
}: {
  n: number;
  children: React.ReactNode;
}) {
  return (
    <li className="voice-prose-sm flex gap-3">
      <span className="voice-data shrink-0 text-ink-faint">{n}.</span>
      <span>{children}</span>
    </li>
  );
}

/** The verify network walkthrough — the request-row list wrapper. */
export function Requests({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-2">{children}</ul>;
}

/** One request row: a hanging mono name, then what it is. */
export function Req({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <li className="voice-prose-sm grid grid-cols-1 gap-0.5 sm:grid-cols-[11rem_1fr] sm:gap-x-4">
      <span className="voice-data text-ink-faint sm:pt-0.5">{name}</span>
      <span>{children}</span>
    </li>
  );
}

/** The dynamic "your audio" request row — the active speech hosts, shown
 *  only when a provider is configured. */
export function ProviderRow() {
  const providers = activeSpeechProviders();
  if (providers.length === 0) return null;
  return (
    <Req name={providers.map((p) => p.wsOrigin.replace("wss://", "")).join(", ")}>
      your audio, streaming to {providers.map((p) => p.label).join(" or ")},
      only while the wax seal is lit, never after.
    </Req>
  );
}

/** The privacy page's collapsible mechanics deep-dive. The author puts
 *  the mechanics paragraphs (Markdown) as children. */
export function Deepdive({ children }: { children: React.ReactNode }) {
  return (
    <details className="group mt-2 rounded-[7px] border border-rule-faint px-4 py-3">
      <summary className="voice-label-sm cursor-pointer list-none text-ink-soft marker:content-none hover:text-ink">
        The mechanics, for the curious
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="ml-1 inline-block h-[0.95em] w-[0.95em] -translate-y-[0.06em] transition-transform group-open:rotate-90"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="9 6 15 12 9 18" />
        </svg>
      </summary>
      <div className="mt-3 space-y-3">{children}</div>
    </details>
  );
}

// re-export so an .mdx can pull emphasis explicitly if needed (Markdown
// **bold** already maps to this)
export { Em };
