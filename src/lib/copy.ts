/**
 * Source of truth for user-facing copy.
 *
 * Every visible string the product speaks should live here, grouped by where
 * it appears and under what condition. Components import from this object
 * instead of inlining text, so wording changes in one place and can't drift —
 * and so special cases (a one-off empty state, a per-day prompt) stay
 * discoverable here instead of buried in a component three files deep.
 *
 * House voice (see DESIGN.md / the snippets-craft skill): quiet, literary,
 * terse, sentence case, curly quotes, ellipsis as `…`. No exclamation marks,
 * no emoji, no sparkle-AI framing.
 *
 * Adding copy: put the string here under the nearest group and reference it —
 * don't inline new visible text in a component. This file is a plain constant,
 * so a reference picks up edits automatically; there's no build step.
 */
export const copy = {
  /** today's capture, housed in the calendar's blue fill zone */
  todayZone: {
    /** the very first invitation — nothing has ever been saved */
    placeholderFirstEver: "Start saving your memories…",
    /** every day after, once the book holds something */
    placeholder: "Write something from today…",
  },

  /** the inline composer that backfills a past — or reopened — day */
  backfill: {
    today: "Add something from today…",
    yesterday: "Add something from yesterday…",
    other: "Add something you want to remember…",
  },

  /** search fields */
  search: {
    /** the ⌘K command menu */
    command: "Search, or jump somewhere…",
    /** the schedule header's find field */
    schedule: "Find an entry…",
  },
} as const;

export type Copy = typeof copy;
