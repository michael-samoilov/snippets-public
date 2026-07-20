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
      "A pocket notebook. Catch the stories, jokes, and stray thoughts of your day before they evaporate.",
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

  /**
   * The first-ever introduction — shown on the today zone only before
   * anything has been kept, and it retires itself the moment the writer
   * starts (it's prose on the sheet, never a card or a dialog). Two
   * jobs: what this is for, and why it's safe to invest in. Workshop
   * the paragraphs here; they render as-is.
   */
  intro: {
    body: [
      "Snippets is an app to capture your daily moments.",
      "Inspired by Matthew Dicks’s book [_Storyworthy_](https://matthewdicks.com/Books/storyworthy/) and his “Homework for Life”: take five minutes each day to capture its most storyworthy moment. Over time, the days no longer blur, you’ll find joy amidst terrible luck, and you’ll have a massive bank of stories to share in your writing or conversations.",
      "Also inspired by Gwern Branwen: “[_Never let a joke go to waste._](https://gwern.net/interview-inkhaven#opening-speech) _People are constantly saying interesting things and good starting points for a blog post. The problem is that they laugh and immediately forget everything._”",
      "About this app: Everything is stored on this device by default. If you make an account, you can access your entries across devices. You can then connect your Google Drive to sync your entries off the app automatically, so your words are yours even if this app ever disappears. And if you like, you can turn on end-to-end encryption — then no one but you, including us, can read what you keep.",
      "How you remember your days is how you remember your life.",
    ] as const,
  },

  /** capture — the day's composer and the voice seal */
  capture: {
    sectionLabel: "Capture an entry",
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
      speak: "Speak an entry",
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
          "Re-allow it in your browser’s site settings to speak your entries.",
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
    placeholderFirstEver:
      "Start saving your memories… Press the microphone to record, or write here and press the seal to submit.",
    /** every day after, once the book holds something */
    placeholder: "Write something from today…",
    /** today already holds an entry — invite another */
    placeholderHasEntry: "Add something else from today…",
    /** accessible name for the zone's field, e.g. "Write an entry for June 22" */
    ariaWriteFor: (dateLabel: string) => `Write an entry for ${dateLabel}`,
    /** the wax button's accessible name, by whether words are present */
    keepEntry: "Keep today's entry",
    speakEntry: "Speak today's entry",
    /**
     * The locked letter — a returning writer on a new device that doesn't
     * hold the encryption key. Their entries wait sealed on the server, so
     * without a word of explanation the calendar reads as an empty book
     * (or worse, greets them like a newcomer). Recognition first, never a
     * scolding; like the intro it retires the moment the writer starts —
     * it must stay safe to live with the locked state a while.
     */
    locked: {
      /** count: the server's entry count, when known and none of it is already visible here */
      body: (count: number | null) => [
        count && count > 1
          ? `Welcome back. The ${count.toLocaleString()} entries you’ve kept are end-to-end encrypted, and this device doesn’t hold the key yet — so they aren’t showing here.`
          : "Welcome back. Your entries are end-to-end encrypted, and this device doesn’t hold the key yet — so they aren’t showing here.",
        "Enter your passphrase — or your recovery code — and everything fills back in. Anything new you write stays safe on this device in the meantime.",
      ],
      action: "Unlock in Settings",
    },
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
    description: "Search your entries or jump somewhere",
    empty: "Nothing found.",
    inTheBook: "In your entries",
    goTo: "Go to",
    do: "Do",
    switchTo: (themeName: string) => `Switch to ${themeName}`,
    exportJSON: "Export as JSON",
    exportMarkdown: "Export as Markdown",
  },

  /** the `?` keyboard cheat sheet */
  shortcuts: {
    title: "Keyboard",
    groups: {
      move: "Move around",
      write: "Write",
      grid: "In the calendar",
      global: "Anywhere",
    },
    back: "Back a level",
    search: "Search your entries",
    today: "Go to today",
    step: "Step through time",
    goCanvas: "To the calendar",
    goGlance: "To the year",
    capture: "Start writing today",
    edit: "Rewrite the open entry",
    file: "File the entry",
    newline: "New line",
    dayStep: "Move a day",
    weekStep: "Move a week",
    monthStep: "Move a month",
    yearStep: "Move a year",
    openDay: "Open the day",
    command: "Command menu",
    thisSheet: "This sheet",
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
    /** the account mark's accessible name (a single link to Settings) */
    label: "Account",
  },

  /** the sign-in page */
  signin: {
    title: "Sign in",
    lead:
      "Your entries stay on this device either way — signing in keeps a copy on the server and lets another device carry them too.",
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
    /** the quiet agreement line beneath the sign-in actions; the two
        phrases render as links to /terms and /privacy */
    agree: "By signing in you agree to the",
    agreeTerms: "terms of service",
    agreeAnd: "and the",
    agreePrivacy: "privacy policy",
    errors: {
      invalidEmail: "That doesn’t look like an address.",
      sendFailed: "The code couldn’t be sent. Try again in a moment.",
      badCode: "That code didn’t match. Codes last ten minutes.",
      notConfigured: "Sign-in isn’t switched on for this install.",
      googleFailed: "Google didn’t complete the sign-in. Try again.",
    },
  },

  /**
   * The one-time offer shown just after signing in: now that a copy of
   * your entries rests on the server, this is the honest moment to offer
   * to encrypt them. Never required — "Not now" leaves it exactly where
   * it is, in Settings, and the offer doesn't return on this device.
   */
  welcome: {
    title: "Encrypt your entries?",
    body: "Your entries now keep a copy on our server, so you can reach them from another device. If you like, you can encrypt them — with a key only your devices hold, so no one else can read them, us included. It takes a minute, and you can always turn it on later in Settings.",
    seal: "Set up encryption",
    later: "Not now",
  },

  /** the Settings page */
  settings: {
    title: "Settings",
    back: "Back to your entries",
    /** the two top-level sections of the page */
    tabs: {
      /** the tablist's accessible name */
      label: "Settings sections",
      appearance: "Appearance",
      account: "Account",
      agreement: "Agreement",
    },
    /** the Agreement tab — two rows that open the full documents */
    agreement: {
      lead: "How Snippets handles your words, and the terms you use it under. Each opens in full.",
      privacy: "Privacy policy",
      privacySub: "What happens to your data — and what we can and can’t read.",
      terms: "Terms of service",
      termsSub: "The agreement — what you may expect of us, and we of you.",
    },
    /**
     * The status indicators that head each protection's own section
     * (Account/sync, Encryption, Backup). A glyph, a small-caps state
     * word, and a mono readout line beneath — matching the sync/backup
     * data voice.
     */
    protection: {
      encrypted: "Encrypted",
      /** concrete, not a metaphor: the point is that no one else can read them */
      encryptedSub: "Even we can’t see your entries — only your devices hold the key.",
      locked: "Locked",
      lockedSub: "This device holds no key yet — unlock below to read.",
      notEncrypted: "Not encrypted",
      synced: "Synced",
      /** time, then the device/server integrity counts — one line, no repeat below */
      syncedSub: (when: string, counts: string | null) =>
        counts ? `${when} · ${counts}` : when,
      syncing: "Syncing",
      syncingSub: "Carrying your latest entries…",
      syncWaitingSub: "Waiting for the first sync…",
      syncSnag: "Sync snag",
      syncSnagSub: "Retrying — your entries are safe on this device.",
      syncPaused: "Sync paused",
      /** the counts make the pause concrete — what's here vs what waits sealed */
      syncPausedSub: (device: string | null, server: string | null) =>
        device !== null && server !== null
          ? `Unlock encryption to sync — ${device} on this device, ${server} waiting on the server.`
          : "Unlock encryption to sync this device.",
      signedOut: "Signed out",
      signedOutSub: "Your session ended — sign in again to keep syncing.",
      offline: "Offline",
      offlineSub: "Changes will sync when you’re back.",
      backedUp: "Backed up",
      /** short verb so the line doesn't wrap */
      backedUpSub: (when: string) => `Sent to your Drive · ${when}`,
      backupFirstSub: "The first delivery is on its way…",
      backupFailing: "Backup failing",
      backupOff: "Backup off",
      backupOffSub: "Connect Google Drive for a readable copy.",
    },
    account: {
      heading: "Account",
      signedOutLead:
        "Sign in and your entries keep a copy on the server — carried to any device you sign in on.",
      signIn: "Sign in",
      signedInAs: (email: string) => `Signed in as ${email}.`,
      signOut: "Sign out",
      signOutHint: "Your entries stay on this device.",
      /** the tiny mono device-count line shown when signed out, e.g. "1,204 entries on this device" */
      deviceCount: (n: string, one: boolean) =>
        `${n} ${one ? "entry" : "entries"} on this device`,
      deleteAccount: {
        trigger: "Delete account…",
        title: "Delete your account?",
        body:
          "This removes your account and everything it keeps on the server — your synced entries, your sign-in, the Google Drive connection — immediately and permanently. The entries on this device stay, and backups already delivered to your Drive remain yours. Hold the button down to be sure.",
        hold: "Hold to delete",
        done: "Your account is gone. This device keeps its copy.",
        failed: "The account couldn’t be deleted. Try again in a moment.",
      },
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
      /** how sync behaves — sets the expectation that idle cross-device isn't instant */
      cadence:
        "Your entries sync the moment you open Snippets and just after you write. While it stays open it also checks now and then for changes from your other devices, so an untouched second device catches up within a few minutes rather than instantly.",
      /** the tiny mono integrity line, e.g. "1,204 on device · 1,204 on server" */
      counts: (device: string, server: string) =>
        `${device} on device · ${server} on server`,
      /** same line while offline — the server side can't be known, so name the state */
      countsOffline: (device: string) => `${device} on device · you’re offline`,
      outOfStep: "The counts disagree.",
      /** the fix action, named by what it literally does — pull is merge-safe */
      reconcile: "Re-download all entries",
      /** what pressing it will actually do — the same LWW rule as every
          sync, walked over the whole book; honest about deletions */
      reconcileHint:
        "This re-checks every entry against the server and keeps whichever copy is newer — the same rule every sync follows, applied to everything at once. Nothing is removed unless you deleted it somewhere yourself.",
    },
    encryption: {
      heading: "Encryption",
      offLead:
        "Turn on end-to-end encryption and your entries are encrypted with a key only your devices hold — unreadable on the server, by anyone, including us. Your Drive backups stay readable; they’re yours.",
      turnOn: "Turn on end-to-end encryption",
      onLead: "End-to-end encryption is on. Only your devices hold the key.",
      turnOff: "Turn off encryption",
      turnOffHold: "Hold to turn off",
      // no "must be unlocked" caveat: the turn-off control only renders on a
      // device that already holds the key, so the precondition can never be
      // read anywhere it isn't already met (and "unlocked" read as the phone's
      // own lock screen anyway)
      turnOffHint:
        "Every entry — including ones written while encrypted — returns to ordinary encryption, where the service holds the keys and could read them again.",
      turningOff: "Turning off…",
      turnOffFailed: "Couldn’t turn it off just now. Try again in a moment.",
      lockedLead:
        "This account is end-to-end encrypted, and this device doesn’t hold the key yet.",
      passphraseLabel: "Choose a passphrase",
      passphraseConfirmLabel: "Once more",
      passphrasePlaceholder: "a phrase only you would know",
      unlockLabel: "Your passphrase",
      unlock: "Unlock",
      unlocking: "A moment…",
      useRecovery: "Use my recovery code instead",
      usePassphrase: "Use my passphrase instead",
      recoveryLabel: "Your recovery code",
      enrollTitle: "Encrypt your entries?",
      enrollBody:
        "Your entries — including everything you’ve already written — will be encrypted with a key only your devices hold. If you forget the passphrase, the recovery code — shown once, next — is the only other way in. Your Google Drive backups stay readable either way, so even a lost key never costs you the words.",
      enrollConfirm: "Encrypt",
      enrolling: "Encrypting…",
      tooShort: "A passphrase needs at least ten characters.",
      tooWeak:
        "That one is still easy to guess — a longer phrase, or a few unexpected words together, is far harder to crack.",
      // the quiet live read beneath the field, by strength
      strengthWeak: "Still easy to guess.",
      strengthOk: "Strong enough.",
      strengthStrong: "Very strong.",
      mismatch: "Those two didn’t match.",
      wrongSecret:
        "That didn’t open it. Codes and phrases must match exactly — spaces and capitals included.",
      enrollFailed: "Your entries couldn’t be encrypted just now. Try again in a moment.",
      recoveryTitle: "Your recovery code",
      recoveryBody:
        "Shown exactly once. If you forget your passphrase, this code is the only other key — save it somewhere safe.",
      downloadKit: "Download recovery file",
      recoveryFileNote:
        "Downloading saves a plain-text file holding your account email and this recovery code — keep it somewhere private.",
      recoveryDone: "I’ve saved it",
    },
    backup: {
      heading: "Backup",
      lead:
        "A readable copy of your entries — Markdown and a restorable archive — that lands in a Snippets folder in your own Google Drive a little after you write. Yours even if this app disappears.",
      connect: "Connect Google Drive",
      connecting: "Connecting…",
      /** reassurance: the folder is a one-way mirror, safe to touch */
      mirrors:
        "That folder only mirrors your entries — delete or change anything in it and the next delivery sets it right again.",
      /** shown when the account is connected but THIS device holds no Drive
          grant yet — any number of devices can hold one and all deliver */
      deliversElsewhere:
        "Right now it’s your other devices doing the delivering — this one hasn’t been added. Add it and it delivers too; every device you add keeps the copy fresh.",
      /** the one-tap per-device grant; reuses the same Google consent */
      connectHere: "Back up from this device too",
      /** e.g. "Backups haven’t gone through since June 30." */
      failingSince: (when: string) => `Backups haven’t gone through since ${when}.`,
      failingNoSuccess: "Backups haven’t gone through yet.",
      reconnect: "Reconnect Google Drive",
      /** the danger-zone-style title + description that head the disconnect button */
      disconnectTitle: "Disconnect Google Drive",
      disconnectDesc:
        "Backups stop. The files already in your Drive stay where they are.",
      disconnect: "Disconnect",
      disconnecting: "Disconnecting…",
      scopeDeclined:
        "Google didn’t grant the Drive permission — try again and leave the box ticked.",
      connectFailed: "Drive couldn’t be connected. Try again in a moment.",
      disconnectFailed: "Couldn’t disconnect just now. Try again in a moment.",
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
    danger: {
      heading: "Danger zone",
      eraseTitle: "Let everything go",
      eraseDesc:
        "Erase every entry on this device, permanently. Export a copy first if you might want one.",
      eraseDescSynced:
        "Erase every entry — here, on the server, and on every device signed in to this account — permanently. Your Google Drive backup mirrors this: the next delivery empties it too. Export a copy first if you might want one.",
      eraseHold: "Hold to erase",
      deleteTitle: "Delete account",
      deleteDesc:
        "Remove your account and everything it keeps on the server — your sign-in, synced entries, and the Google Drive connection. This device keeps its copy.",
      deleteHold: "Hold to delete",
    },
    data: {
      heading: "Your data",
      lead:
        "Everything lives in this browser — kept on this device, yours alone.",
      /** "{n} entries so far." — inserted mid-paragraph */
      countSoFar: (n: number) =>
        `${n} ${n === 1 ? "entry" : "entries"} so far.`,
      takeCopy: "Take a copy whenever you like.",
      /** the storage-health line, e.g. "storage: using 4 MB of 60 GB" */
      storageLine: (used: string, quota: string) =>
        `storage: using ${used} of ${quota}`,
      /** the browser granted persistent storage — name what that protects against */
      storageKept:
        "The browser has agreed to keep this data even if the device runs low on space.",
      /** persistence denied — name the concrete circumstance, and the way out */
      storageEvictableSignedOut:
        "If this device runs low on space, the browser is allowed to clear this site’s data — and your entries with it. Signing in keeps a copy on the server.",
      storageEvictableSignedIn:
        "If this device runs low on space, the browser is allowed to clear this site’s data — your entries stay safe on the server.",
      /** shown under a best-effort line — why it matters, what helps */
      exportJSON: "Export JSON",
      exportMarkdown: "Export Markdown",
      restore: "Restore from JSON…",
      eraseAll: "Let everything go…",
    },
    about: {
      heading: "About",
      // a paragraph with the book title in italics — rendered in three parts
      lead: "Snippets is a pocket notebook, made in the spirit of Matthew Dicks’ ",
      workTitle: "Homework for Life",
      rest: ": at the end of each day, keep the most storyworthy thing that happened. Jokes, quotes, and stray phrases are welcome too. Good lines shouldn’t go to waste.",
    },
    erase: {
      title: "Let everything go?",
      body:
        "This erases every entry on this device, permanently. If you want a copy first, export before you do this. Hold the button down to be sure.",
      bodySynced:
        "This erases every entry — here, on the server, and on every device signed in to this account, permanently. Your Google Drive backup mirrors this: the next delivery empties it too. If you want a copy first, export before you do this. Hold the button down to be sure.",
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
    /** the loud, specific case: the device is out of room */
    storageFull:
      "This device’s storage is full — that entry was not saved. Your words are still in the composer; clear some space and keep it again.",
  },
} as const;

export type Copy = typeof copy;
