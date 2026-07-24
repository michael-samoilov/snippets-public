import type { Metadata } from "next";
import { PageBackHeader } from "@/components/page-back-header";
import Content, { updated } from "./content.mdx";

export const metadata: Metadata = { title: "Terms of service" };

/**
 * The terms: the agreement side of the privacy page's promises, in the
 * same register — plain sentences, no legalese thunder. The prose lives in
 * `content.mdx`; like the privacy page it states only what the service
 * actually does, so when the service changes this content changes in the
 * same commit and `updated` moves.
 */
export default function TermsPage() {
  return (
    <PageBackHeader title="Terms">
      <div className="space-y-8">
        <p className="voice-data text-ink-faint">
          last updated {updated.toLowerCase()}
        </p>
        <div className="policy-prose">
          <Content />
        </div>
      </div>
    </PageBackHeader>
  );
}
