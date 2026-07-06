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
    /** placeholder while listening but nothing's said yet */
    listeningPlaceholder: "Listening…",
    /** the transcriber has the recording and is setting the words */
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
     * SpeechFailure. A `service` failure means two different things depending
     * on the engine, so the toast resolves it against `speech.engine`:
     *   - the browser's own dictation (web engine) refused → `service.*`,
     *     the ONE case where the browser is genuinely at fault. On iOS every
     *     browser is WebKit, so we never tell an iOS user to switch browsers.
     *   - a network transcriber (Deepgram/Scribe/batch) refused, e.g. a bad
     *     key, quota, or an unconfigured server → `serviceRemote`, which is
     *     on our side, not the browser's.
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
          "Voice transcribes over the network. Check the connection and try the seal again, or write it instead.",
      },
      // the browser's built-in speech recognition (web engine) refused —
      // the only failure where the browser itself is the problem
      service: {
        title: "This browser won’t start dictation.",
        descriptionInstalledIOS:
          "iOS blocks voice inside installed web apps. Open Snippets in Safari itself for voice — writing works everywhere.",
        descriptionIOSBrowser:
          "iOS only does voice through Safari’s built-in dictation, and it isn’t responding right now. Writing works everywhere.",
        descriptionOtherwise:
          "This browser wouldn’t start speech recognition. Writing works everywhere — Safari, Chrome, or Edge on desktop handle voice best.",
      },
      // a network transcriber refused (bad key, quota, server unconfigured) —
      // our side, never the browser's
      serviceRemote: {
        title: "Voice is offline right now.",
        description:
          "The transcription service isn’t responding — that’s on our side, not yours. Write it and it saves just the same.",
      },
      transcribe: {
        title: "The words couldn’t be set.",
        description:
          "What you said was heard but transcription failed. Try the seal again, or write it.",
      },
      "too-long": {
        title: "That take ran long.",
        description:
          "Recordings stop at five minutes. What was said is being set now. Split longer thoughts and keep both halves.",
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
    /** today already holds an entry — invite another */
    placeholderHasEntry: "Add something else from today…",
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
    signIn: "Sign in to sync across devices",
    settings: "Settings…",
    signOut: "Sign out",
  },

  /** the sign-in page */
  signin: {
    title: "Sign in",
    back: "Back to the book",
    lead:
      "Your book stays on this device either way — signing in keeps a copy on the server and lets another device carry it too.",
    emailLabel: "Email",
    emailPlaceholder: "you@example.com",
    sendCode: "Send a code",
    sending: "Sending…",
    /** after the code goes out */
    codeSent: (email: string) => `A six-digit code is on its way to ${email}.`,
    codeLabel: "The six-digit code",
    verify: "Sign in",
    verifying: "A moment…",
    differentEmail: "Use a different address",
    /** the rule between the email flow and Google */
    or: "or",
    google: "Continue with Google",
    errors: {
      invalidEmail: "That doesn’t look like an address.",
      sendFailed: "The code couldn’t be sent. Try again in a moment.",
      badCode: "That code didn’t match. Codes last ten minutes.",
      notConfigured: "Sign-in isn’t switched on for this install.",
      googleFailed: "Google didn’t complete the sign-in. Try again.",
    },
  },

  /** the Settings page */
  settings: {
    title: "Settings",
    back: "Back to the book",
    account: {
      heading: "Account",
      signedOutLead:
        "Sign in and the book keeps a copy on the server — carried to any device you sign in on.",
      signIn: "Sign in",
      signedInAs: (email: string) => `Signed in as ${email}.`,
      signOut: "Sign out",
      signOutHint: "Your entries stay on this device.",
    },
    sync: {
      syncing: "Syncing…",
      syncedAt: (time: string) => `Synced ${time}.`,
      neverSynced: "Waiting for the first sync…",
      pending: (n: number) =>
        `${n} ${n === 1 ? "entry" : "entries"} waiting to sync.`,
      offline: "Offline — changes will sync when you’re back.",
      error: "Sync hit a snag — retrying.",
      skewed: "This device’s clock runs oddly — sync still works, but times may look off.",
      /** the tiny mono integrity line, e.g. "1,204 here · 1,204 on the server" */
      counts: (device: string, server: string) =>
        `${device} here · ${server} on the server`,
      outOfStep: "The counts disagree.",
      reconcile: "Reconcile",
    },
    backup: {
      heading: "Backup",
      lead:
        "A copy of your book, delivered to a Snippets folder in your own Google Drive once a day — readable Markdown and a restorable archive. Yours even if this app disappears.",
      connect: "Connect Google Drive",
      connecting: "Connecting…",
      /** e.g. "Last delivered to your Drive: yesterday, 6:12 am." */
      lastDelivered: (when: string) => `Last delivered to your Drive: ${when}.`,
      firstOnItsWay: "The first delivery is on its way…",
      /** e.g. "Backups haven’t gone through since June 30." */
      failingSince: (when: string) => `Backups haven’t gone through since ${when}.`,
      failingNoSuccess: "Backups haven’t gone through yet.",
      reconnect: "Reconnect Google Drive",
      scopeDeclined:
        "Google didn’t grant the Drive permission — try again and leave the box ticked.",
      connectFailed: "Drive couldn’t be connected. Try again in a moment.",
    },
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
      rest: ": at the end of each day, keep the most storyworthy thing that happened. Jokes, quotes, and stray phrases are welcome too. Good lines shouldn’t go to waste.",
    },
    erase: {
      title: "Let everything go?",
      body:
        "This erases every entry on this device, permanently. If you want a copy first, export before you do this. Hold the button down to be sure.",
      bodySynced:
        "This erases every entry — here, on the server, and on every device signed in to this account, permanently. If you want a copy first, export before you do this. Hold the button down to be sure.",
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
    keepFailed: "That didn’t take. Try again.",
  },
} as const;

export type Copy = typeof copy;
