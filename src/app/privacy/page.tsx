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
            Turn on end-to-end encryption (Settings → Encryption) and no.
            Your entries are sealed on your device with a key derived from
            your passphrase, and only the sealed form ever reaches the
            server — it stores and syncs envelopes it cannot open. The key
            itself never leaves your devices, is held in a form the browser
            will not export, and the only copies that exist elsewhere are
            wrapped under your passphrase and your recovery code. This is
            the same architecture the established end-to-end encrypted
            services use (Proton Mail, Bitwarden, Signal&rsquo;s web pairing):
            the server is a courier of sealed envelopes, not a reader.
          </p>
          <p className="voice-prose text-[0.95rem]">
            One honest limit, shared by every encrypted web app: your browser
            runs the code our server sends, so you are ultimately trusting
            that code — reading anything would require shipping compromised
            software to your browser, never a quiet lookup in a database.
            And encryption hides content, not rhythm: the server still sees
            that entries exist, when they change, and their size. Without
            end-to-end encryption turned on, entries rest on the server
            under standard provider-level encryption, readable by the
            service — the same posture as ordinary note apps.
          </p>
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
