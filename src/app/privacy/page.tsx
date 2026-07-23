import type { Metadata } from "next";
import Link from "next/link";
import { PageBackHeader } from "@/components/page-back-header";
import { SectionHeading } from "@/components/section-heading";
import { activeSpeechProviders } from "@/lib/speech-providers";

export const metadata: Metadata = { title: "Privacy" };

/**
 * The privacy page: the answer first, in one line, then the data-flow at
 * a glance, then the details for anyone who wants them. It states only
 * what the code actually does — when the code changes, this page changes
 * in the same commit, and the date below moves with it. Every claim here
 * is checkable at /verify.
 */
const LAST_UPDATED = "July 23, 2026";

/** Emphasis — bold against the prose, so load-bearing lines stand out. */
function Em({ children }: { children: React.ReactNode }) {
  return <strong className="font-bold">{children}</strong>;
}

/**
 * One line of the data-flow at the top: a small-caps label and a plain
 * sentence of what happens. Typeset, not a card — the label column is
 * the left rail the eye scans (law 6: no cards, no iconography).
 */
function Flow({
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

export default function PrivacyPage() {
  const voice = activeSpeechProviders();
  return (
    <PageBackHeader title="Privacy">
      <div className="space-y-10">
        <p className="voice-data text-ink-faint">
          last updated {LAST_UPDATED.toLowerCase()}
        </p>

        {/* the answer, first */}
        <h1 className="voice-display text-[2rem] leading-[1.08] sm:text-[2.4rem]">
          We cannot read your entries. Not won&rsquo;t, can&rsquo;t.
        </h1>

        {/* the data-flow at a glance */}
        <div className="space-y-5 border-y border-rule-faint py-6">
          <Flow label="Your words">
            Written into this device. Signed out, they never reach us.
          </Flow>
          <Flow label="Sync">
            When you sign in: encrypted on your device before it is sent. We
            hold the encrypted copy, never the key that opens it.
          </Flow>
          <Flow label="Your voice">
            Streams to a transcription service to become text, then it is gone.
            We store none of it.
          </Flow>
          <Flow label="Backup">
            Off until you turn it on. Then readable copies go to a folder in
            your own Google Drive — your safety net if you lose your key.
          </Flow>
        </div>

        <p className="voice-prose text-[0.95rem]">
          Snippets runs in your browser. Signed out, it makes no network
          requests of its own, so every entry stays on this device. Sign in and
          one path opens — an encrypted copy on our server, so another device
          can carry your entries. <Em>We hold that copy and never the key.</Em>
        </p>

        <p className="voice-prose text-[0.95rem]">
          Don&rsquo;t take our word for it. Turn on airplane mode and keep
          writing; everything works. Or open your browser&rsquo;s network tab
          and watch exactly what leaves.{" "}
          <Link href="/verify" className="underline underline-offset-2">
            See how to check it yourself →
          </Link>
        </p>

        {/* ── the details, for anyone who wants them ─────────────────── */}
        <div className="space-y-8 pt-2">
          <section className="space-y-3">
            <SectionHeading id="end-to-end-encryption">
              How the encryption works
            </SectionHeading>
            <p className="voice-prose-sm">
              Before an entry leaves your device, your browser encrypts it: the
              words become a random-looking string of characters (what our
              server receives) that can be turned back into text only with one
              specific key — a long random number made on your device and never
              sent to us. Your browser holds it as a &ldquo;non-extractable
              key,&rdquo; whose raw value no code can read, this app&rsquo;s
              included.
            </p>
            <p className="voice-prose-sm">
              When you set your passphrase, you also receive a recovery code.
              Each one encrypts its own copy of that key, on your device, and
              only those two encrypted copies reach our server — so any of your
              devices can rebuild the key once you enter your passphrase or
              recovery code. The passphrase and recovery code never leave your
              browser. This is the design Signal, Proton Mail, and Bitwarden
              use: the server keeps the encrypted data and never the key.
              Encryption cannot be turned off, and those two copies of the key
              can never be replaced or removed over the network — only deleting
              your account removes them.
            </p>
            <p className="voice-prose-sm">
              <Em>Two honest limits every encrypted web app lives with.</Em>{" "}
              First, the app is a website: your browser downloads its code from
              us on each visit, so you are trusting that code. For us to read
              your entries we would have to send your browser a version of the
              app changed to steal your key as you type it — and that altered
              code would run in your own browser, open to anyone who inspects
              it, not a silent query against a database. Second, encryption
              hides the contents of your entries, not the fact of them: the
              server still sees that entries exist, roughly how big each is, and
              when each last changed.
            </p>

            {/* the deep dive — Kerckhoffs's principle: publishing the design
                costs nothing, since safety rests on the keys. Native
                <details>, no JS. */}
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
              <div className="mt-3 space-y-3">
                <p className="voice-prose-sm">
                  Every entry is encrypted with{" "}
                  <span className="voice-data">AES-256-GCM</span> — an
                  authenticated cipher, so a tampered entry fails to open rather
                  than decrypting to something wrong — under a fresh random
                  nonce each time. The entry&rsquo;s identifier and timestamps
                  are bound into that check, so a moved, rolled-back, or
                  resurrected entry fails to open too. All of your entries share
                  one random 256-bit key, made on your device.
                </p>
                <p className="voice-prose-sm">
                  That key is encrypted twice, so it can travel between your
                  devices without ever being exposed: once under a key stretched
                  from your passphrase with{" "}
                  <span className="voice-data">
                    PBKDF2-HMAC-SHA-256, 600,000 iterations
                  </span>{" "}
                  and a random salt, and once under a key stretched from a
                  ~120-bit recovery code. The server stores only those two
                  encrypted copies, written once and never silently replaced; it
                  can open neither.
                </p>
                <p className="voice-prose-sm">
                  On your device the key is held as a{" "}
                  <span className="voice-data">non-extractable CryptoKey</span> —
                  the browser decrypts with it but will not export its bytes,
                  even to the page&rsquo;s own scripts. What rests on the server
                  is the encrypted text of each entry plus the fields sync needs
                  in the clear: an identifier, timestamps, and a change counter.
                  No title, text, or tags.
                </p>
                <p className="voice-prose-sm">
                  Drive backups are made and uploaded by your own device from
                  its decrypted copy, so the readable files exist only where your
                  key already is. The server never keeps your Drive credentials —
                  your device holds them and the server only trades them for a
                  short-lived key when asked. Those readable Drive files are the
                  safety net: if you lose both your passphrase and recovery code,
                  they are how you get your words back.
                </p>
              </div>
            </details>
          </section>

          <section className="space-y-3">
            <SectionHeading>Google Drive backup</SectionHeading>
            <p className="voice-prose-sm">
              If you connect Google Drive, readable copies land in a folder in
              your own Drive named &ldquo;Snippets&rdquo; — so that if you lose
              your passphrase and recovery code you can still import your
              entries, and if this app ever disappears you still hold an
              up-to-date copy. These are plain, readable files by design; that
              is what lets them rescue you.{" "}
              <Em>
                They live in your Google account, where Google can read them like
                any other file in your Drive
              </Em>{" "}
              (
              <a
                href="https://policies.google.com/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2"
              >
                Google&rsquo;s privacy policy
              </a>
              ).
            </p>
            <p className="voice-prose-sm">
              The permission this app uses (
              <span className="voice-data">drive.file</span>) lets it see only
              files it created; it cannot read, list, or touch anything else in
              your Drive. Your device renders these files and uploads them
              straight to Google, so our server never receives them. It holds
              none of your Drive credentials either: when your device needs
              fresh access, it passes its Google token through our server only
              long enough to trade it for a short-lived key, storing nothing.
            </p>
          </section>

          <section className="space-y-3">
            <SectionHeading>Voice</SectionHeading>
            <p className="voice-prose-sm">
              If you speak an entry with the microphone, the app streams your
              audio to a transcription service and the words come back as you
              speak. None of it is stored by us. Typing never touches the
              network.
              {voice.length > 0 && " The services, in the order the app tries them:"}
            </p>
            {voice.length > 0 && (
              <ul className="ml-4 list-disc space-y-1.5">
                {voice.map((p) => (
                  <li key={p.name} className="voice-prose-sm">
                    <a
                      href={p.privacyUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2"
                    >
                      {p.label}
                    </a>{" "}
                    — {p.retentionLine}
                  </li>
                ))}
              </ul>
            )}
            <p className="voice-prose-sm">
              One honest edge: if none of those services can be reached, the app
              falls back to your browser&rsquo;s own dictation. That path is the
              browser&rsquo;s, not ours — on most devices the browser sends the
              audio to its maker&rsquo;s speech servers (Google&rsquo;s or
              Apple&rsquo;s), under their policies, and that traffic does not
              show in this app&rsquo;s network activity.
            </p>
          </section>

          <section className="space-y-3">
            <SectionHeading>What we collect, and what we don&rsquo;t</SectionHeading>
            <p className="voice-prose-sm">
              Signing in needs your email address — and, if you use Google, the
              name and profile picture on your Google account. That is all. We
              use no passwords, and signing in is never required to use the app.
            </p>
            <p className="voice-prose-sm">
              No ads, no selling or sharing of your words, no analytics on what
              you write. The only measurement is anonymous page-view counting.
              The only emails are the ones you cause: a sign-in code, or a
              warning that your backups have stopped going through.
            </p>
          </section>

          <section className="space-y-3">
            <SectionHeading>Leaving</SectionHeading>
            <p className="voice-prose-sm">
              <Em>Erasing your entries</Em> (
              <Link href="/settings" className="underline underline-offset-2">
                Settings
              </Link>
              , &ldquo;Let everything go&rdquo;) marks every entry deleted — on
              the server and on every signed-in device — so they disappear
              everywhere at once. The content is then kept for up to 30 days, so
              a mistaken erase can be undone from another device, after which it
              is scrubbed to a contentless marker (an id and timestamps, no
              words) that stops the entry reappearing.
            </p>
            <p className="voice-prose-sm">
              <Em>Deleting your account</Em> (Settings → Account) removes the
              account itself — your sign-in, the Google connection, every synced
              entry and its deletion-marker, and the backup record — from the
              server immediately and for good; we also ask Google to revoke the
              Drive connection. Copies on your devices, and backup files already
              in your Drive, remain yours.
            </p>
          </section>

          <p className="voice-prose-sm text-ink-soft">
            Questions can go to{" "}
            <a
              href="mailto:snippets.support@gmail.com"
              className="underline underline-offset-2"
            >
              snippets.support@gmail.com
            </a>
            . The agreement side — what you may expect of us, and we of you —
            lives in the{" "}
            <Link href="/terms" className="underline underline-offset-2">
              terms of service
            </Link>
            .
          </p>
        </div>
      </div>
    </PageBackHeader>
  );
}
