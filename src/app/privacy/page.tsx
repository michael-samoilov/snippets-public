import type { Metadata } from "next";
import Link from "next/link";
import { PageBackHeader } from "@/components/page-back-header";

export const metadata: Metadata = { title: "Privacy" };

/**
 * The privacy page: plain sentences, in the order a worried person
 * would ask. It states only what the code actually does — when the
 * code changes, this page changes in the same commit, and the date
 * below moves with it.
 */
const LAST_UPDATED = "July 8, 2026";

/** Emphasis — bold against the 420 prose, so load-bearing lines stand out. */
function Em({ children }: { children: React.ReactNode }) {
  return <strong className="font-bold">{children}</strong>;
}

/** A subheading inside a section — small-caps, quieter than the section head. */
function Sub({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3
      id={id}
      className="voice-label scroll-mt-8 pt-3 text-[0.72rem] text-ink-soft"
    >
      {children}
    </h3>
  );
}

/** Contents links — a top-level one, and the nested (subheading) variant. */
function TocLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="voice-prose text-[0.92rem] text-ink-soft underline-offset-2 hover:text-ink hover:underline"
    >
      {children}
    </a>
  );
}

function TocSubLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className="voice-prose text-[0.85rem] text-ink-faint underline-offset-2 hover:text-ink-soft hover:underline"
    >
      {children}
    </a>
  );
}

export default function PrivacyPage() {
  return (
    <PageBackHeader title="Privacy">
      <div className="space-y-8">
        <p className="voice-data text-ink-faint">
          last updated {LAST_UPDATED.toLowerCase()}
        </p>

        <nav aria-label="Contents" className="border-y border-rule-faint py-4">
          <p className="voice-label text-[0.72rem] text-ink-faint">Contents</p>
          <ul className="mt-3 space-y-2">
            <li>
              <TocLink href="#can-you-read">Can you read what I write?</TocLink>
              <ul className="mt-2 ml-3.5 space-y-1.5 border-l border-rule-faint pl-3.5">
                <li>
                  <TocSubLink href="#before-you-sign-in">
                    Before you sign in
                  </TocSubLink>
                </li>
                <li>
                  <TocSubLink href="#if-you-sign-in">If you sign in</TocSubLink>
                </li>
                <li>
                  <TocSubLink href="#end-to-end-encryption">
                    If you turn on end-to-end encryption
                  </TocSubLink>
                </li>
              </ul>
            </li>
            <li>
              <TocLink href="#outside-services">Outside services</TocLink>
              <ul className="mt-2 ml-3.5 space-y-1.5 border-l border-rule-faint pl-3.5">
                <li>
                  <TocSubLink href="#google-drive-backup">
                    Google Drive backup
                  </TocSubLink>
                </li>
                <li>
                  <TocSubLink href="#voice">Voice</TocSubLink>
                </li>
              </ul>
            </li>
            <li>
              <TocLink href="#what-we-dont-do">What we don&rsquo;t do</TocLink>
            </li>
            <li>
              <TocLink href="#leaving">Leaving</TocLink>
            </li>
          </ul>
        </nav>

        <section className="space-y-3">
          <h2
            id="can-you-read"
            className="voice-label scroll-mt-8 border-b border-rule pb-1.5"
          >
            Can you read what I write?
          </h2>
          <p className="voice-prose text-[0.95rem]">
            Whether we can read what you write is up to you. If you
            don&rsquo;t sign in, the answer is <Em>no</Em> — your entries stay
            in this browser and never reach us. If you sign in without
            enabling end-to-end encryption, it&rsquo;s <Em>yes</Em> — a copy
            rests on our server under ordinary encryption whose keys we hold,
            so in principle we could (in practice, we don&rsquo;t). If you turn
            on end-to-end encryption, it&rsquo;s <Em>no</Em> again — only your
            devices hold the key.
          </p>
          <p className="voice-prose text-[0.95rem]">
            Two features reach beyond the app. If you turn on the Google Drive
            backup, or record an entry with the microphone, then Google and the
            transcription service handle that data under their own privacy
            policies — see Google Drive backup and Voice, below.
          </p>
          <Sub id="before-you-sign-in">Before you sign in</Sub>
          <p className="voice-prose text-[0.95rem]">
            Your entries are only written into this browser&rsquo;s own storage
            and never sent to our server,{" "}
            <Em>so we cannot read what you write</Em>.
          </p>
          <Sub id="if-you-sign-in">If you sign in</Sub>
          <p className="voice-prose text-[0.95rem]">
            A copy of your entries rests on our server so you can add entries
            from your other devices. It has ordinary encryption where the
            service (us) holds the keys, just like Apple Notes or Google Keep.{" "}
            <Em>
              In principle your entries here could be accessed, but in practice
              we don&rsquo;t
            </Em>
            .
          </p>
          <p className="voice-prose text-[0.95rem]">
            Otherwise, the only data we collect about you is what signing in
            needs: your email address, and — if you use Google — the name and
            profile picture on your Google account.
          </p>
          <p className="voice-prose text-[0.95rem]">
            We do not use or keep passwords for our sign-in process.{" "}
            <Em>Signing in is also never required to use the app</Em>.
          </p>
          <Sub id="end-to-end-encryption">
            If you turn on end-to-end encryption
          </Sub>
          <p className="voice-prose text-[0.95rem]">
            Turn it on in Settings → Encryption, and{" "}
            <Em>we cannot read what you write</Em>. Before an entry
            leaves your device, your browser encrypts it: the words are turned
            into a random-looking string of characters (what our server
            receives) that can only be decoded back into text with one specific
            key — a long random number created on your device and never sent to
            our server. Your browser stores it as what&rsquo;s called a
            &ldquo;non-extractable key,&rdquo; whose raw value cannot be read by
            any code, including this app&rsquo;s. When you turn on encryption,
            you set a passphrase and receive a recovery code; each one is used,
            on your device, to encrypt its own copy of that key, and only those
            two encrypted copies are sent to our server — so that any of your
            devices can rebuild the key once you enter your passphrase or
            recovery code there. The passphrase and recovery code themselves
            never leave your browser, and unlocking happens entirely on your
            device, so at no point do we receive what would be needed to read
            your entries. This is the same design apps like Signal, Proton Mail,
            and Bitwarden use: the server keeps the encrypted data and never the
            key that decodes it.
          </p>
          <p className="voice-prose text-[0.95rem]">
            Turning encryption on encrypts your existing entries too, not only
            the ones you write next. However: anything you had already synced arrived in
            the clear before you encrypted it, so it could have been read then,
            and a plaintext copy may linger a while in routine database backups.
            Turning encryption back off does the reverse, re-uploading your
            entries readable again.
          </p>
          <p className="voice-prose text-[0.95rem]">
            <Em>Two honest limits that every encrypted web app lives with</Em>.
            First, the app is a website: your browser downloads its code from us
            on each visit, so you are ultimately trusting that code. For us to
            read your entries we would have to &ldquo;hack&rdquo; you — send
            your browser a version of the app deliberately changed to steal your
            key as you type it. Because that altered code would run inside your
            own browser, it is out in the open there for anyone who inspects it,
            rather than a silent query we could run against a database unseen.
            Second, encryption hides the contents of your entries, not the fact
            of them: the server can still see that entries exist, roughly how
            big each one is, and when it last changed.
          </p>

          {/* the opt-in deep dive — Kerckhoffs's principle: publishing the
              design costs nothing, since safety rests on the keys, not the
              secrecy of the method. Native <details>, no JS. */}
          <details className="group mt-2 rounded-[7px] border border-rule-faint px-4 py-3">
            <summary className="voice-label cursor-pointer list-none text-[0.75rem] text-ink-soft marker:content-none hover:text-ink">
              The mechanics, for the curious
              {/* a stroke chevron (Feather, the app's 1.8/24 line), not the ›
                  glyph: the text glyph's ink sits off-centre in its em box,
                  so the old span swung through an arc instead of turning in
                  place. This ink is symmetric about the box centre, so the
                  turn pivots true — and still reads as a chevron once
                  turned, which the swashed Fraunces guillemet did not. */}
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
              <p className="voice-prose text-[0.9rem] text-ink-soft">
                Every entry is encrypted with{" "}
                <span className="voice-data">AES-256-GCM</span> — an
                authenticated cipher, so a tampered entry fails to open rather
                than decrypting to something wrong — under a fresh random nonce
                each time. All of your entries share one random 256-bit key,
                generated on your device.
              </p>
              <p className="voice-prose text-[0.9rem] text-ink-soft">
                That key is what&rsquo;s wrapped (encrypted) twice, so it
                can travel between your devices without ever being exposed: once
                under a key stretched from your passphrase with{" "}
                <span className="voice-data">
                  PBKDF2-HMAC-SHA-256, 600,000 iterations
                </span>{" "}
                and a random salt, and once under a key stretched from a
                ~120-bit recovery code. The server stores only those two wrapped
                envelopes, written once and never silently replaced; it can open
                neither.
              </p>
              <p className="voice-prose text-[0.9rem] text-ink-soft">
                On your device, the unwrapped key is held as a{" "}
                <span className="voice-data">non-extractable CryptoKey</span> —
                the browser will use it to decrypt but will not export its
                bytes, even to the page&rsquo;s own scripts. What rests on the
                server is the ciphertext of each entry plus the fields sync
                needs in the clear: an identifier, timestamps, and a change
                counter. No title, text, tags, or kind.
              </p>
              <p className="voice-prose text-[0.9rem] text-ink-soft">
                Drive backups are rendered and uploaded by your own device from
                its decrypted copy, so the readable files exist only where your
                key already is. The server never keeps your Drive credentials —
                your device holds them and the server only trades them for a
                short-lived access token when asked. Those plaintext Drive files
                are also the safety net: if you lose both your passphrase and
                your recovery code, they are how you get your words back.
              </p>
            </div>
          </details>
        </section>

        <section className="space-y-3">
          <h2
            id="outside-services"
            className="voice-label scroll-mt-8 border-b border-rule pb-1.5"
          >
            Outside services
          </h2>
          <Sub id="google-drive-backup">Google Drive backup</Sub>
          <p className="voice-prose text-[0.95rem]">
            If you connect Google Drive, readable copies land in a
            folder in your own Drive named &ldquo;Snippets&rdquo; — so that (A)
            if you use encryption and lose your passphrase and recovery code, you
            can still import your entries and keep saving your memories, and (B)
            so that if this app ever disappears, you still hold a safe,
            up-to-date copy of them. Whether or not you use encryption, these
            are plain, readable files by design — that is what lets them rescue
            you.{" "}
            <Em>
              They live in your Google account, where Google can read them like
              any other file you keep in your Drive
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
          <p className="voice-prose text-[0.95rem]">
            The permission this app uses (
            <span className="voice-data">drive.file</span>) lets the app see
            only files it created; it cannot read, list, or touch anything else
            in your Drive. Your device renders these files and uploads them
            straight to Google, so our server never receives them or keeps a
            copy — and it holds none of your Drive credentials: when your device
            needs fresh access, it passes its Google token through our server
            only long enough to trade it with Google for a short-lived key,
            storing nothing. A compromised server could abuse that moment of
            transit — the same honest ceiling as the app&rsquo;s own code — but
            only to reach these Drive files, which are readable by design
            anyway; your encrypted entries stay sealed on our server whatever
            happens to the token. In normal use, the files never pass through us
            at all.
          </p>

          <Sub id="voice">Voice</Sub>
          <p className="voice-prose text-[0.95rem]">
            If you speak an entry with the in-app microphone, the app
            streams your audio to a transcription service — currently{" "}
            <a
              href="https://deepgram.com/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              Deepgram
            </a>{" "}
            or{" "}
            <a
              href="https://elevenlabs.io/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2"
            >
              ElevenLabs
            </a>
            , whose privacy policies apply to that processing. The words come
            back, the audio is not kept, and none of it is stored by us. Typing
            never touches the network.
          </p>
        </section>

        <section className="space-y-3">
          <h2
            id="what-we-dont-do"
            className="voice-label scroll-mt-8 border-b border-rule pb-1.5"
          >
            What we don&rsquo;t do
          </h2>
          <p className="voice-prose text-[0.95rem]">
            No ads, no selling or sharing of your words, no analytics on what
            you write. The only measurement is anonymous page-view counting. The
            only emails are the ones you cause: a sign-in code, or a warning
            that your backups have stopped going through.
          </p>
        </section>

        <section className="space-y-3">
          <h2
            id="leaving"
            className="voice-label scroll-mt-8 border-b border-rule pb-1.5"
          >
            Leaving
          </h2>
          <p className="voice-prose text-[0.95rem]">
            <Em>Erasing your entries</Em> (
            <Link href="/settings" className="underline underline-offset-2">
              Settings
            </Link>
            , &ldquo;Let everything go&rdquo;) marks every entry deleted — on
            the server and on every signed-in device — so they disappear
            everywhere at once. The content is then kept for up to 30 days, so a
            mistaken erase can still be undone from another device, after which
            it is automatically scrubbed, leaving only a contentless marker (an
            id and timestamps, no words) that stops the entry reappearing.
          </p>
          <p className="voice-prose text-[0.95rem]">
            <Em>Deleting your account</Em> (Settings → Account) deletes the
            account itself — your sign-in, the Google connection, every synced
            entry and its deletion-marker, and the backup record — from the
            server immediately and for good; we also ask Google to revoke the
            Drive connection.
          </p>
          <p className="voice-prose text-[0.95rem]">
            Copies on your devices, and backup files already delivered to your
            Drive, remain yours.
          </p>
        </section>

        <p className="voice-prose text-[0.9rem] text-ink-soft">
          The agreement side of things — what you may expect of us, and we of
          you — lives in the{" "}
          <Link href="/terms" className="underline underline-offset-2">
            terms of service
          </Link>
          .
        </p>
      </div>
    </PageBackHeader>
  );
}
