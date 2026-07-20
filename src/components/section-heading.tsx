import { cn } from "@/lib/utils";

/**
 * The one section heading: the label voice over its hairline rule.
 * Every titled section (settings, privacy, on-this-day) renders this so
 * the treatment can't drift per-site. `tone="ember"` is the danger
 * zone's variant — ember ink, no rule (its bordered card already
 * encloses it).
 */
export function SectionHeading({
  tone,
  id,
  className,
  children,
}: {
  tone?: "ember";
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className={cn(
        "voice-label",
        tone === "ember" ? "text-ember" : "border-b border-rule pb-1.5",
        className,
      )}
    >
      {children}
    </h2>
  );
}
