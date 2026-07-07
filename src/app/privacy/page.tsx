import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy" };

/**
 * The privacy page: plain sentences, in the order a worried person
 * would ask. It states only what the code actually does — when the
 * code changes, this page changes in the same commit.
 */
export default function PrivacyPage() {
  return (
    <div className="page-settle">
      <header className="mb-8">
        <h1 className="voice-display text-[2.5rem] leading-[1.02] sm:text-[2.9rem]">
          Privacy
        </h1>
      </header>

      <div className="max-w-[52ch] space-y-8">
        <section className="space-y-3">
          <h2 className="voice-label border-b border-rule pb-1.5">
            Where your words live
          </h2>
          <p className="voice-prose text-[0.95rem]">
            Snippets is local-first. Your entries are written into this
            browser&rsquo;s own storage, on your device. With no account,
            nothing you write leaves it — except as described under Filing,
            below.
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
            on your Google account. Connecting Drive backup also stores
            Google&rsquo;s access tokens so the daily backup can run; you can
            revoke them anytime from your Google account. Signing in is never
            required — the app is whole without it.
          </p>
          <p className="voice-prose text-[0.95rem]">
            Erasing your book in Settings while signed in erases it from the
            server and from every signed-in device, not just this one.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="voice-label border-b border-rule pb-1.5">
            Google Drive backup
          </h2>
          <p className="voice-prose text-[0.95rem]">
            If you connect Google Drive, once a day the server writes your
            backup files into a visible &ldquo;Snippets&rdquo; folder in your
            own Drive. The permission used (
            <span className="voice-data">drive.file</span>) lets the app see
            only files it created — it cannot read, list, or touch anything
            else in your Drive. The backup exists so your words remain yours
            even if this app disappears.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="voice-label border-b border-rule pb-1.5">Filing</h2>
          <p className="voice-prose text-[0.95rem]">
            When automatic filing is on, the text of a new entry is sent to
            Anthropic&rsquo;s Claude API to suggest a title, kind, and tags.
            Only the entry text is sent, it is not used to train models, and
            you can turn filing off in Settings — everything else works the
            same.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="voice-label border-b border-rule pb-1.5">Voice</h2>
          <p className="voice-prose text-[0.95rem]">
            Speaking a snippet streams your audio to a transcription service
            (or uses the browser&rsquo;s own dictation) to set the words, and
            the audio is not kept. Typing never touches the network.
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
