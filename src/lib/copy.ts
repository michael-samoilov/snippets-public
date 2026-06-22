/**
 * Source of truth for user-facing copy.
 *
 * Every visible (or spoken-to-a-screen-reader) string the product says lives
 * here, grouped by where it appears and under what condition. Components import
 * from this object instead of inlining text, so wording changes in one place
 * and can't drift — and so special cases (a one-off empty state, a per-day
 * prompt) stay discoverable here instead of buried in a component.
 *
 * House voice (see DESIGN.md / the snippets-craft skill): quiet, literary,
 * terse, sentence case, curly quotes, ellipsis as `…`. No exclamation marks,
 * no emoji, no sparkle-AI framing.
 *
 * Adding copy: put the string here under the nearest group and reference it —
 * don't inline new visible text in a component. This file is a plain constant,
 * so a reference picks up edits automatically; there's no build step. Dynamic
 * lines (a count, a day name) are small functions returning the finished
 * string.
 *
 * Not centralised on purpose: pure date/number formatting (month names, "Today"
 * / "Yesterday", clock times — see src/lib/dates.ts), the export file's own
 * Markdown structure (src/lib/export.ts), and the kind table (src/lib/kinds.ts,
 * a domain structure whose labels feed search and aren't shown).
 */
export const copy = {
  /** brand + document metadata (layout + web manifest share these) */
  app: {
    name: "Snippets",
    titleTemplate: "%s · Snippets",
    description:
      "A pocket commonplace book. Catch the stories, jokes, and stray thoughts of your day before they evaporate.",
  },

  /** primary navigation — the desktop links and the mobile dock */
  nav: {
    /** landmark label for both nav regions */
    primary: "Primary",
    today: "Today",
    calendar: "Calendar",
    account: "Account",
    /** the dock repeats the two destinations in lowercase (small-caps face) */
    dock: { today: "today", calendar: "calendar" },
  },

  /** the Today page */
  today: {
    /** "{n} kept" */
    kept: "kept",
    /** "· {n} days running" */
    daysRunning: "days running",
    /** the kept-today section ("Kept today · {n}") and its landmark label */
    keptToday: "Kept today",
    /** shown only before anything has ever been kept */
    empty:
      "Your days are fuller than you think. Catch one true moment before it evaporates — a line someone said, a small scene, a joke that landed. Two sentences is plenty.",
  },

  /** capture — the day's composer and the voice seal */
  capture: {
    sectionLabel: "Capture a snippet",
    keep: "Keep",
    /**
     * The day's rotating questions, in the spirit of Homework for Life.
     * Specific beats open-ended: a narrow question is easier to answer.
     * Indexed by day-of-year so the question is stable all day.
     */
    dailyPrompts: [
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
    ],
    /** placeholder while the web engine is listening but nothing's said yet */
    listeningPlaceholder: "Listening…",
    /** Aqua has the recording and is transcribing (inline, by the words) */
    settingWords: "Setting your words…",
    /** the controls-row hint while transcribing */
    aMoment: "a moment…",
    /** the controls-row hint while listening */
    listeningHint: "Listening — tap the seal to stop",
    /** the resting controls-row hint, voice available */
    hint: "speak it or write it",
    /** the resting hint where this browser can't do voice */
    noVoiceHint:
      "this browser doesn’t offer voice capture — Chrome, Safari, or Edge do; writing works everywhere",
    /** the wax seal's accessible name, by state */
    seal: {
      speak: "Speak a snippet",
      stop: "Stop listening",
      busy: "Setting your words",
    },
    /**
     * Voice never fails silently — every failure says what happened. Keyed by
     * SpeechFailure. `service` differs for an installed iOS PWA vs elsewhere.
     */
    voiceFailures: {
      denied: {
        title: "The microphone was declined.",
        description:
          "Re-allow it in your browser’s site settings to speak your snippets.",
      },
      "no-mic": {
        title: "No microphone found.",
        description:
          "Plug one in or check your input settings — writing works meanwhile.",
      },
      network: {
        title: "The speech service couldn’t be reached.",
        description:
          "This browser transcribes over the network. Check the connection, or write it instead.",
      },
      service: {
        title: "Voice isn’t available here.",
        descriptionInstalledIOS:
          "iOS doesn’t allow voice inside installed web apps yet. Open Snippets in Safari itself for voice — writing works everywhere.",
        descriptionOtherwise:
          "This browser is refusing speech recognition. Chrome, Safari, or Edge offer it — writing works everywhere.",
      },
      transcribe: {
        title: "Aqua couldn’t set the words.",
        description:
          "The recording was made but transcription failed. Try the seal again, or write it.",
      },
      "too-long": {
        title: "That take ran long.",
        description:
          "Recordings stop at five minutes — what was said is being set now. Split longer thoughts and keep both halves.",
      },
      unknown: {
        title: "Voice capture hit a snag.",
        description: "Try the seal again, or write it — nothing was lost.",
      },
    },
  },

  /** today's capture, housed in the calendar's blue fill zone */
  todayZone: {
    /** the very first invitation — nothing has ever been saved */
    placeholderFirstEver: "Start saving your memories…",
    /** every day after, once the book holds something */
    placeholder: "Write something from today…",
    /** accessible name for the zone's field, e.g. "Write an entry for June 22" */
    ariaWriteFor: (dateLabel: string) => `Write an entry for ${dateLabel}`,
    /** the wax button's accessible name, by whether words are present */
    keepEntry: "Keep today's entry",
    speakEntry: "Speak today's entry",
  },

  /** the inline composer that backfills a past — or reopened — day */
  backfill: {
    today: "Add something from today…",
    yesterday: "Add something from yesterday…",
    other: "Add something you want to remember…",
    /** accessible name, e.g. "Add an entry to Yesterday" */
    ariaAddTo: (dayLabel: string) => `Add an entry to ${dayLabel}`,
  },

  /** keeping an entry — the wax-stamp confirmations */
  keep: {
    /** the stamp's accessible name */
    label: "Keep this",
    /** confirm-stamp after rewriting an existing entry */
    doneRewrite: "Done — keep the rewrite",
    /** the "Kept." stamp on today */
    stampedToday: "Kept.",
    /** the "Kept to yesterday." stamp on a backfilled day */
    stampedTo: (dayLabel: string) => `Kept to ${dayLabel}.`,
  },

  /** opening, rewriting, and letting go of a single entry */
  entry: {
    rewrite: "Rewrite this entry",
    /** the edit field's accessible name */
    words: "The entry’s words",
    letGo: "Let this entry go",
  },

  /** the undo toast after deleting */
  deleteEntry: {
    toast: "Let go.",
    undo: "Undo",
  },

  /** search — the ⌘K menu and the schedule's find field */
  search: {
    command: "Search, or jump somewhere…",
    schedule: "Find an entry…",
    /** the schedule find field's accessible name */
    entriesLabel: "Search entries",
  },

  /** the schedule/calendar's back button, by altitude */
  calendar: {
    backToGlance: (year: number) => `Show ${year} at a glance`,
    backToGrid: (monthLabel: string) => `Back to the ${monthLabel} grid`,
    backToDays: "Back to the days",
  },

  /** the ⌘K command menu */
  commandMenu: {
    title: "Command menu",
    description: "Search the book or jump somewhere",
    empty: "Nothing found.",
    inTheBook: "In the book",
    goTo: "Go to",
    do: "Do",
    switchTo: (themeName: string) => `Switch to ${themeName}`,
    exportJSON: "Export as JSON",
    exportMarkdown: "Export as Markdown",
  },

  /** theme names (settings swatches + the command menu's switch) */
  themes: {
    paper: "Paper",
    lamplight: "Lamplight",
    system: "System",
  },

  /** "On this day" — memories resurfacing */
  memories: {
    heading: "On this day",
    oneYearAgo: "One year ago",
    yearsAgo: (n: number) => `${n} years ago`,
    oneMonthAgo: "One month ago",
  },

  /** the account mark and its menu */
  account: {
    label: "Account",
    syncSoon: "Sign in to sync across devices — soon",
    settings: "Settings…",
  },

  /** the Settings page */
  settings: {
    title: "Settings",
    appearance: {
      heading: "Appearance",
      /** the theme radiogroup's accessible name */
      themeLabel: "Theme",
    },
    calendar: {
      heading: "Calendar",
      startWeek: "Start week on",
      startWeekHint:
        "The day the month grid and the year’s minis begin the week on.",
      sunday: "Sunday",
      monday: "Monday",
    },
    filing: {
      heading: "Filing",
      auto: "Automatic filing",
      autoHint:
        "New entries are quietly filed by Claude — a title, a kind, tags — kept in the data to make search smarter, never shown on the page. Needs an API key on the server. Your words stay on this device either way — only the entry text is sent for filing.",
    },
    data: {
      heading: "Your data",
      lead:
        "Everything lives in this browser — kept on this device, yours alone.",
      /** "{n} entries so far." — inserted mid-paragraph */
      countSoFar: (n: number) =>
        `${n} ${n === 1 ? "entry" : "entries"} so far.`,
      takeCopy: "Take a copy whenever you like.",
      exportJSON: "Export JSON",
      exportMarkdown: "Export Markdown",
      restore: "Restore from JSON…",
      eraseAll: "Let everything go…",
    },
    about: {
      heading: "About",
      // a paragraph with the book title in italics — rendered in three parts
      lead: "Snippets is a pocket commonplace book, made in the spirit of Matthew Dicks’ ",
      workTitle: "Homework for Life",
      rest: ": at the end of each day, keep the most storyworthy thing that happened. Jokes, quotes, and stray phrases are welcome too — good lines shouldn’t go to waste.",
    },
    erase: {
      title: "Let everything go?",
      body:
        "This erases every entry on this device, permanently. If you want a copy first, export before you do this. Hold the button down to be sure.",
      cancel: "Keep everything",
      hold: "Hold to erase",
      holding: "Hold…",
    },
    toasts: {
      restored: (n: number) =>
        `Restored ${n} ${n === 1 ? "entry" : "entries"}.`,
      importFailed: "That file couldn’t be read.",
      erased: "The page is blank again.",
    },
  },

  /** data import/export errors surfaced to the reader */
  data: {
    notExportFile: "Not a Snippets export file.",
    noEntriesInFile: "No entries found in that file.",
    /** the inline composer's catch-all when a keep fails */
    keepFailed: "That didn’t take — try again.",
  },
} as const;

export type Copy = typeof copy;
