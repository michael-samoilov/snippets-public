import type { SnippetKind } from "@/lib/types";
import { copy } from "@/lib/copy";

interface KindMeta {
  /** singular, sentence case — used on chips and labels */
  label: string;
  /** plural, for filters and counts */
  plural: string;
  /** CSS color token */
  color: string;
  /** one-line definition shown when choosing by hand */
  hint: string;
}

export const KIND_META: Record<SnippetKind, KindMeta> = {
  story: {
    label: "Story",
    plural: "Stories",
    color: "var(--kind-story)",
    hint: "A moment that could be told aloud",
  },
  joke: {
    label: "Joke",
    plural: "Jokes",
    color: "var(--kind-joke)",
    hint: "A line that got a laugh, or deserved one",
  },
  quote: {
    label: "Quote",
    plural: "Quotes",
    color: "var(--kind-quote)",
    hint: "Someone else's words, worth keeping",
  },
  idea: {
    label: "Idea",
    plural: "Ideas",
    color: "var(--kind-idea)",
    hint: "Something to make, try, or chew on",
  },
  phrase: {
    label: "Phrase",
    plural: "Phrases",
    color: "var(--kind-phrase)",
    hint: "A word or turn of phrase that delighted you",
  },
  observation: {
    label: "Observation",
    plural: "Observations",
    color: "var(--kind-observation)",
    hint: "Something noticed, plainly seen",
  },
};

/**
 * The day's rotating capture question (the prompts live in src/lib/copy.ts).
 * Indexed by day-of-year so the question is stable all day.
 */
export function promptForDate(date: Date): string {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (date.getTime() - start.getTime()) / 86_400_000,
  );
  const prompts = copy.capture.dailyPrompts;
  return prompts[dayOfYear % prompts.length];
}
