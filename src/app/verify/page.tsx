import type { Metadata } from "next";
import Link from "next/link";
import { PageBackHeader } from "@/components/page-back-header";
import { PolicySection } from "@/components/policy";
import { activeSpeechProviders } from "@/lib/speech-providers";

export const metadata: Metadata = { title: "Verify" };

/**
 * The test bench for the privacy page's claims: three checks a reader
 * can run themselves, so "we cannot read your entries" rests on their
 * own eyes, not our word. Everything here must stay true of the code —
 * when behavior changes, this page changes in the same commit. The
 * service worker precaches this route: the airplane-mode test it
 * describes must itself work with the network off.
 */

/** Emphasis — bold against the prose, so load-bearing lines stand out. */
function Em({ children }: { children: React.ReactNode }) {
  return <strong className="font-bold">{children}</strong>;
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="voice-prose-sm flex gap-3">
      <span className="voice-data shrink-0 text-ink-faint">{n}.</span>
      <span>{children}</span>
    </li>
  );
}

/** A request row in the network walkthrough: what you'll see, and why. */
function Req({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <li className="voice-prose-sm">
      <span className="voice-data">{name}</span> — {children}
    </li>
  );
}

export default function VerifyPage() {
  const providers = activeSpeechProviders();
  return (
    <PageBackHeader title="Verify">
      <div className="space-y-8">
        <p className="voice-prose text-[0.95rem]">
          The <Link href="/privacy" className="underline underline-offset-2">privacy
          policy</Link> makes claims. This page is how you check them yourself —
          three tests, a few minutes, no trust required. If any of them ever
          fails, the claims are false and we want to know:{" "}
          <a
            href="mailto:snippets.support@gmail.com"
            className="underline underline-offset-2"
          >
            snippets.support@gmail.com
          </a>
          .
        </p>

        <PolicySection id="airplane" title="Test 1 — Airplane mode">
          <p className="voice-prose-sm">
            The claim: signed out, your entries never leave this device —
            capture needs no network at all.
          </p>
          <ol className="space-y-2">
            <Step n={1}>Open Snippets once, so it can install itself.</Step>
            <Step n={2}>Turn on airplane mode.</Step>
            <Step n={3}>
              Write an entry and press the wax seal. It keeps. Browse your
              book. Everything works. (Voice is the exception — transcription
              runs over the network, so the microphone needs a connection.)
            </Step>
            <Step n={4}>
              Close the app, reopen it, still offline: your entry is there.
            </Step>
          </ol>
          <p className="voice-prose-sm">
            <Em>There is nothing to disconnect from.</Em>{" "}
            Signed out, the app
            has no server side — your words are written into this
            device&rsquo;s own storage and that is the whole story.
          </p>
        </PolicySection>

        <PolicySection id="network" title="Test 2 — Watch the network">
          <p className="voice-prose-sm">
            The claim: every request this app makes is one you can predict —
            and none of them carries readable entries.
          </p>
          <ol className="space-y-2">
            <Step n={1}>
              On a computer, open the browser&rsquo;s developer tools (usually
              F12) and pick the Network tab.
            </Step>
            <Step n={2}>Use Snippets: write, browse, sync if you sign in.</Step>
            <Step n={3}>Read the request list against the table below.</Step>
          </ol>
          <p className="voice-prose-sm">
            The complete list of what you will see, and why:
          </p>
          <ul className="ml-4 list-disc space-y-1.5">
            <Req name="snippets.ink">
              the app itself — pages, scripts, styles, fonts, paper textures.
            </Req>
            <Req name="/_vercel/insights">
              anonymous page-view counting. It carries no entry data — open
              one and look.
            </Req>
            <Req name="/api/auth/…">
              signing in and the session check. Only if you use an account.
            </Req>
            <Req name="/api/sync/push, /api/sync/pull">
              your entries to and from the server — encrypted.{" "}
              <Em>
                Open a push request and read its payload: a v/iv/ct envelope
                of random-looking characters, not words.
              </Em>{" "}
              That envelope is exactly what our server stores.
            </Req>
            <Req name="/api/keys">
              the two encrypted copies of your key (made when you set your
              passphrase). The passphrase itself never appears — search the
              request for it.
            </Req>
            <Req name="/api/…-token">
              a short-lived voice token, fetched just before a take so the
              real API key stays on the server.
            </Req>
            {providers.length > 0 && (
              <Req
                name={providers
                  .map((p) => p.wsOrigin.replace("wss://", ""))
                  .join(", ")}
              >
                your audio, streaming to{" "}
                {providers.map((p) => p.label).join(" or ")} — only while the
                wax seal is lit, never after.
              </Req>
            )}
            <Req name="www.googleapis.com">
              backup files traveling from this device to your own Google
              Drive. Only if you connected the backup.
            </Req>
          </ul>
          <p className="voice-prose-sm">
            One honest gap: if the app ever falls back to your
            browser&rsquo;s built-in dictation, that audio is sent by the
            browser itself (to Google&rsquo;s or Apple&rsquo;s speech servers)
            and does not show in this tab. The privacy policy&rsquo;s Voice
            section covers it.
          </p>
        </PolicySection>

        <PolicySection id="csp" title="Test 3 — The allowlist your browser enforces">
          <p className="voice-prose-sm">
            The claim: this app <Em>cannot</Em> send data anywhere you
            haven&rsquo;t seen above — not by policy, but because your browser
            refuses to let it.
          </p>
          <p className="voice-prose-sm">
            Every page we serve carries a{" "}
            <span className="voice-data">Content-Security-Policy</span> header.
            Its <span className="voice-data">connect-src</span> line names
            every origin this app is allowed to contact; the browser blocks
            anything else before it leaves. Check the header from any
            terminal:
          </p>
          <pre className="overflow-x-auto rounded-[7px] border border-rule-faint px-4 py-3">
            <code className="voice-data">
              curl -sI https://www.snippets.ink | grep -i content-security
            </code>
          </pre>
          <p className="voice-prose-sm">
            Or paste <span className="voice-data">snippets.ink</span> into{" "}
            <a
              href="https://securityheaders.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              securityheaders.com
            </a>
            . The origins you find in <span className="voice-data">connect-src</span>{" "}
            are the ones from Test 2 — the whole list, enforced.
          </p>
          <p className="voice-prose-sm">
            <Em>What this test can and cannot prove.</Em>{" "}
            It proves where data
            can go. It cannot prove the code is honest — the header allows
            inline scripts (our framework needs them), and a web app&rsquo;s
            code arrives fresh from the server on each visit, so you are
            trusting that delivery. That is exactly why Tests 1 and 2 exist:
            they check behavior, not promises. And a header is only as good as
            its being there tomorrow — it costs one curl to check again.
          </p>
        </PolicySection>

        <p className="voice-prose-sm text-ink-soft">
          Want to go deeper? The privacy policy&rsquo;s{" "}
          <Link
            href="/privacy#end-to-end-encryption"
            className="underline underline-offset-2"
          >
            &ldquo;How the encryption works&rdquo;
          </Link>{" "}
          section names the exact algorithms and what rests on the server.
        </p>
      </div>
    </PageBackHeader>
  );
}
