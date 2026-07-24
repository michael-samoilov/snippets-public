import type { Metadata } from "next";
import { PageBackHeader } from "@/components/page-back-header";
import Content, { updated } from "./content.mdx";

export const metadata: Metadata = { title: "Privacy" };

/**
 * The privacy page: the answer first, in one line, then the data flow at
 * a glance, then the details for anyone who wants them. The prose lives in
 * `content.mdx` (Markdown → the design system via `mdx-components.tsx`);
 * the structured pieces are in `src/components/policy-mdx.tsx`. It states
 * only what the code actually does — when the code changes, the content
 * file changes in the same commit, and `updated` moves with it. Every
 * claim here is checkable at /verify.
 */
export default function PrivacyPage() {
  return (
    <PageBackHeader title="Privacy">
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
