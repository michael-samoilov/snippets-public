import type { SnippetKind } from "@/lib/types";

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
 * The day's rotating questions, in the spirit of Homework for Life.
 * Specific beats open-ended: a narrow question is easier to answer.
 * Index by day-of-year so the question is stable all day.
 */
export const DAILY_PROMPTS = [
  "If today were a story, where would it begin?",
  "What almost didn't happen today?",
  "What did someone say today that you want to remember?",
  "What was the smallest good thing today?",
  "What surprised you today?",
  "What would you tell a friend about today?",
  "What did you notice today that nobody else seemed to?",
  "When did you laugh today?",
  "What was today's moment?",
  "What changed today, even slightly?",
  "Who was unexpectedly kind today — or unexpectedly strange?",
  "What will you have forgotten by next week, unless you keep it?",
  "Where were you today that you'd like to stand again?",
  "What went wrong today that might make a good story?",
] as const;

export function promptForDate(date: Date): string {
  const start = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor(
    (date.getTime() - start.getTime()) / 86_400_000,
  );
  return DAILY_PROMPTS[dayOfYear % DAILY_PROMPTS.length];
}
