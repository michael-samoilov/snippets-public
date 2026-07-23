import type { Metadata } from "next";
import { PageBackHeader } from "@/components/page-back-header";
import Content from "./content.mdx";

export const metadata: Metadata = { title: "Verify" };

/**
 * The test bench for the privacy page's claims: three checks a reader can
 * run themselves, so "we cannot read your entries" rests on their own
 * eyes, not our word. The prose lives in `content.mdx`; the numbered
 * steps, the network table, and the dynamic provider row are in
 * `src/components/policy-mdx.tsx`. Everything here must stay true of the
 * code — when behavior changes, this content changes in the same commit.
 * The service worker precaches this route: the airplane-mode test it
 * describes must itself work with the network off.
 */
export default function VerifyPage() {
  return (
    <PageBackHeader title="Verify">
      <div className="policy-prose">
        <Content />
      </div>
    </PageBackHeader>
  );
}
