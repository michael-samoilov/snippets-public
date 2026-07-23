import type { Metadata } from "next";
import Link from "next/link";
import { PageBackHeader } from "@/components/page-back-header";
import { SectionHeading } from "@/components/section-heading";
import { Em } from "@/components/prose";

export const metadata: Metadata = { title: "Terms of service" };

/**
 * The terms: the agreement side of the privacy page's promises, in the
 * same register — plain sentences, no legalese thunder. Like the privacy
 * page, it states only what the service actually does; when the service
 * changes, this page changes in the same commit and the date moves.
 */
const LAST_UPDATED = "July 23, 2026";

/** A titled clause: the shared heading over its body, matching privacy. */
function Clause({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <SectionHeading id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}

export default function TermsPage() {
  return (
    <PageBackHeader title="Terms">
      <div className="space-y-8">
        <p className="voice-data text-ink-faint">
          last updated {LAST_UPDATED.toLowerCase()}
        </p>

        <p className="voice-prose text-[0.95rem]">
          Snippets is a notebook: the app at snippets.ink and — if you sign
          in — the sync, backup, and voice services behind it. Using it means
          you agree to these terms and to the{" "}
          <Link href="/privacy" className="underline underline-offset-2">
            privacy policy
          </Link>
          , which explains what happens to your data. The short version of
          both: <Em>the words are yours</Em>, and we&rsquo;ve tried to write
          that into the design, not just the fine print.
        </p>

        <Clause id="your-words" title="Your words are yours">
          <p className="voice-prose text-[0.95rem]">
            Everything you write or speak into Snippets belongs to you. We
            claim <Em>no ownership and no rights over your entries</Em>{" "}beyond
            the narrow, technical permission needed to run the features you
            turn on: storing a copy so your other devices can fetch it,
            carrying a voice recording to a transcription service and back,
            delivering backup files to your own Google Drive. That permission
            ends where those features end — we do not sell your entries, use
            them for advertising, train AI on them, or use them for anything
            but carrying them where you pointed.
          </p>
        </Clause>

        <Clause id="promises" title="What we promise, and what we can’t">
          <p className="voice-prose text-[0.95rem]">
            Snippets is free, and we work to keep it fast, private, and
            durable. But it is provided <Em>as is</Em>: we can&rsquo;t promise
            it will always be available, uninterrupted, or free of mistakes.
            What we can do is make sure a failure never traps your words —
            they live on your device first, you can export them at any time,
            and the Drive backup keeps readable copies in storage you own.
            Please use those.
          </p>
          <p className="voice-prose text-[0.95rem]">
            To the fullest extent the law allows, our liability to you is
            limited to what you&rsquo;ve paid us for the service — which today
            is nothing. Nothing in these terms takes away rights your local
            law says can&rsquo;t be waived.
          </p>
        </Clause>

        <Clause id="encryption" title="Encryption gives you the only key">
          <p className="voice-prose text-[0.95rem]">
            Signing in encrypts your entries end-to-end: your passphrase and
            recovery code are the only ways to read your synced entries — that
            is the feature. If you lose both, neither we nor anyone else can
            unlock them, and we can&rsquo;t be responsible for that loss. The
            readable files in your Drive exist precisely so a lost key never
            costs you the words.
          </p>
        </Clause>

        <Clause id="account" title="Your account">
          <p className="voice-prose text-[0.95rem]">
            You need to be at least 13 years old — or older, where your
            country sets a higher age for agreeing to services like this one.
            Sign in with an email address that is yours, and keep control of
            it: anything done under your sign-in is yours to answer for.
            Signing in is never required to use the app on one device.
          </p>
        </Clause>

        <Clause id="fair-use" title="Fair use">
          <p className="voice-prose text-[0.95rem]">
            Snippets is a private notebook, and what you write in it is your
            business. What we ask is narrow: don&rsquo;t use the service to
            store or spread material that is unlawful to possess;
            don&rsquo;t attack the service or try to reach other
            people&rsquo;s entries; don&rsquo;t strain it with automated
            abuse. We don&rsquo;t read or moderate entries — but we may
            suspend an account that attacks the service, and we&rsquo;ll act
            on unlawful material where the law requires it.
          </p>
        </Clause>

        <Clause id="leaving" title="Leaving, and endings">
          <p className="voice-prose text-[0.95rem]">
            You can leave whenever you like: export your entries, disconnect
            Drive, or delete your account in Settings — deletion is immediate
            and permanent on our side, and the privacy policy details exactly
            what goes. We may close an account that breaks these terms. And if
            Snippets itself ever winds down, the design is the promise:{" "}
            <Em>
              your device keeps its copy, your Drive keeps readable files
            </Em>
            , and we&rsquo;ll give whatever notice we can.
          </p>
        </Clause>

        <Clause id="other-services" title="Other people’s services">
          <p className="voice-prose text-[0.95rem]">
            Google handles Google sign-in and your Drive under Google&rsquo;s
            own terms. Voice transcription runs through the speech services
            named in the privacy policy, under theirs. Where their systems
            process your data, their terms and privacy policies govern that
            processing.
          </p>
        </Clause>

        <Clause id="changes" title="Changes">
          <p className="voice-prose text-[0.95rem]">
            The app will keep changing — features will arrive, shift, and
            sometimes retire. These terms may change with it; when they do,
            the date at the top moves, and if a change matters we&rsquo;ll say
            so in the app. Using Snippets after a change means you accept it.
          </p>
        </Clause>

        <Clause id="questions" title="Questions">
          <p className="voice-prose text-[0.95rem]">
            About these terms, or anything the app does:{" "}
            <a
              href="mailto:snippets.support@gmail.com"
              className="underline underline-offset-2"
            >
              snippets.support@gmail.com
            </a>
            .
          </p>
        </Clause>
      </div>
    </PageBackHeader>
  );
}
