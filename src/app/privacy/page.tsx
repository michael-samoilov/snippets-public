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

export default function PrivacyPage() {
  return (
    <div className="page-settle">
      <PageBackHeader title="Privacy" />

      <div className="max-w-[52ch] space-y-8">
        <p className="voice-data -mt-4 text-ink-faint">
          last updated {LAST_UPDATED.toLowerCase()}
        </p>
        <section className="space-y-3">
          <h2 className="voice-label border-b border-rule pb-1.5">
            Where your words live
          </h2>
          <p className="voice-prose text-[0.95rem]">
            Snippets is local-first. Your entries are written into this
            browser&rsquo;s own storage, on your device. With no account,
            nothing you type ever leaves it — the only thing sent anywhere
            is the audio of a snippet you choose to speak (see Voice, below).
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="voice-label border-b border-rule pb-1.5">
            If you sign in
          </h2>
          <p className="voice-prose text-[0.95rem]">
            Signing in keeps a copy of your entries on the server so another
            device can carry them too. That copy is stored in a managed
            Postgres database, encrypted at rest and in transit. The only
            things kept about you are what signing in needs: your email
            address, and — if you use Google — the name and profile picture
            on your Google account. Signing in is never required — the app
            is whole without it.
          </p>
          <p className="voice-prose text-[0.95rem]">
            Erasing your book in Settings while signed in erases it from the
            server and from every signed-in device, not just this one.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="voice-label border-b border-rule pb-1.5">
            Can you read what I write?
          </h2>
          <p className="voice-prose text-[0.95rem]">
            If you turn on end-to-end encryption (Settings → Encryption):
            no — not the words. Before an entry leaves your device it is
            locked with a key made from your passphrase, and only the locked
            version is ever sent to or stored on the server. We hold the
            locked box; you hold the only key. Syncing, backing up, showing
            you your own book — all of it works on the locked form, so at no
            point does the server need to open it, and it cannot.
          </p>
          <p className="voice-prose text-[0.95rem]">
            The key never leaves your devices, and it is kept in a form your
            browser refuses to hand back out as raw data. The only copies
            that exist anywhere else are themselves locked — one under your
            passphrase, one under your recovery code. This is the same
            approach the trusted end-to-end encrypted services use (Proton
            Mail, Bitwarden, Signal): the server is a courier of sealed
            envelopes, not a reader of them.
          </p>
          <p className="voice-prose text-[0.95rem]">
            Two honest limits, the same ones every encrypted web app lives
            with. First, a website runs code your browser downloads from us
            each visit, so ultimately you are trusting that code — reading
            your entries would mean deliberately shipping bad software to
            your own browser, which is a visible act of sabotage, not a
            quiet peek at a database. Second, encryption hides the words, not
            the rhythm: the server can still tell that entries exist, roughly
            how big they are, and when they change. And if you leave
            encryption off, your entries rest under ordinary provider-level
            encryption, readable by the service — the same as a normal notes
            app.
          </p>

          {/* the opt-in deep dive — Kerckhoffs's principle: publishing the
              design costs nothing, since safety rests on the keys, not the
              secrecy of the method. Native <details>, no JS. */}
          <details className="group mt-2 rounded-[7px] border border-rule-faint px-4 py-3">
            <summary className="voice-label cursor-pointer list-none text-[0.75rem] text-ink-soft marker:content-none hover:text-ink">
              The mechanics, for the curious
              <span className="ml-1 inline-block transition-transform group-open:rotate-90">
                ›
              </span>
            </summary>
            <div className="mt-3 space-y-3">
              <p className="voice-prose text-[0.9rem] text-ink-soft">
                Every entry is encrypted with{" "}
                <span className="voice-data">AES-256-GCM</span> — an
                authenticated cipher, so a tampered entry fails to open
                rather than decrypting to something wrong — under a fresh
                random nonce each time. All of your entries share one random
                256-bit <em>book key</em>, generated on your device.
              </p>
              <p className="voice-prose text-[0.9rem] text-ink-soft">
                That book key is what&rsquo;s wrapped (encrypted) twice, so it
                can travel between your devices without ever being exposed:
                once under a key stretched from your passphrase with{" "}
                <span className="voice-data">
                  PBKDF2-HMAC-SHA-256, 600,000 iterations
                </span>{" "}
                and a random salt, and once under a key stretched from a
                ~120-bit recovery code. The server stores only those two
                wrapped envelopes, written once and never silently replaced;
                it can open neither.
              </p>
              <p className="voice-prose text-[0.9rem] text-ink-soft">
                On your device, the unwrapped book key is held as a{" "}
                <span className="voice-data">non-extractable CryptoKey</span>{" "}
                — the browser will use it to decrypt but will not export its
                bytes, even to the page&rsquo;s own scripts. What rests on the
                server is the ciphertext of each entry plus the fields sync
                needs in the clear: an identifier, timestamps, and a change
                counter. No title, text, tags, or kind.
              </p>
              <p className="voice-prose text-[0.9rem] text-ink-soft">
                Drive backups are rendered and uploaded by your own device
                from its decrypted copy, so the readable files exist only
                where your key already is. The server never keeps your Drive
                credentials — your device holds them and the server only
                trades them for a short-lived access token when asked. Those
                plaintext Drive files are also the safety net: if you lose
                both your passphrase and your recovery code, they are how you
                get your words back.
              </p>
            </div>
          </details>
        </section>

        <section className="space-y-3">
          <h2 className="voice-label border-b border-rule pb-1.5">
            Google Drive backup
          </h2>
          <p className="voice-prose text-[0.95rem]">
            If you connect Google Drive, your device delivers readable copies
            of your book into a visible &ldquo;Snippets&rdquo; folder in your
            own Drive — after you write, from where you write. The permission
            used (<span className="voice-data">drive.file</span>) lets the
            app see only files it created — it cannot read, list, or touch
            anything else in your Drive. The credentials for your Drive are
            held on your device, not kept on the server; the server only
            exchanges them for short-lived access when your device asks. The
            backup exists so your words remain yours even if this app
            disappears — and if you use end-to-end encryption and ever lose
            your passphrase and recovery code, these readable files are your
            way back in.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="voice-label border-b border-rule pb-1.5">Voice</h2>
          <p className="voice-prose text-[0.95rem]">
            Speaking a snippet streams your audio to a transcription service
            — currently{" "}
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
            , whose privacy policies apply to that processing — or uses the
            browser&rsquo;s own dictation. The words come back, the audio is
            not kept, and none of it is stored by us. Typing never touches
            the network.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="voice-label border-b border-rule pb-1.5">
            What we don&rsquo;t do
          </h2>
          <p className="voice-prose text-[0.95rem]">
            No ads, no selling or sharing of your words, no analytics on what
            you write. The only measurement is anonymous page-view counting.
            The only emails are the ones you cause: a sign-in code, or a
            warning that your backups have stopped going through.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="voice-label border-b border-rule pb-1.5">
            Leaving
          </h2>
          <p className="voice-prose text-[0.95rem]">
            Erasing your book (
            <Link href="/settings" className="underline underline-offset-2">
              Settings
            </Link>
            , &ldquo;Let everything go&rdquo;) removes your entries from the
            server and from every signed-in device. Deleting your account
            (Settings → Account) removes the account itself — your sign-in,
            synced entries, and the Drive connection — from the server
            immediately and permanently. Copies on your devices, and backup
            files already delivered to your Drive, remain yours.
          </p>
        </section>
      </div>
    </div>
  );
}
