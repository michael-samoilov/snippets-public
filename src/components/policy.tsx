import { cn } from "@/lib/utils";

/**
 * The building blocks the policy pages (Privacy, Terms) share, so their
 * sticky-heading behaviour can't drift between the two. A <PolicySection>
 * is a titled band whose heading pins to the top of the scroller; a
 * <PolicySub> nests inside one, its heading pinning just beneath the
 * section head and pushing out the previous subheading as you scroll.
 *
 * The stacking is pure CSS position:sticky — see `.policy-head` /
 * `.policy-sub` in globals.css. The one structural rule those depend on:
 * each subheading must own its containing block, so a <PolicySub> wraps
 * its own heading + body in a plain <div> (below), and the section's body
 * is a single flow the head sticks within.
 */
export function PolicySection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 id={id} className="policy-head voice-label scroll-mt-16">
        {title}
      </h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

export function PolicySub({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    // the subsection's own containing block: this <div> is what the sticky
    // <h3> pushes up and out of when the next subsection arrives
    <div className={cn(className)}>
      <h3 id={id} className="policy-sub voice-label-sm scroll-mt-[4.5rem] text-ink-soft">
        {title}
      </h3>
      <div className="space-y-3 pt-1">{children}</div>
    </div>
  );
}
