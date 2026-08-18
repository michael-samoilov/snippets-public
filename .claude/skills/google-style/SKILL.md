---
name: google-style
description: House prose standard distilled from the Google developers style guide (developers.google.com/style). Governs everything written in Claude's own voice in this repo—replies, visible thinking, commit messages, PR and review text, repo docs, and code comments. A SessionStart hook injects it automatically; load it manually if it is not already in context. App UI copy is exempt and stays governed by snippets-craft and DESIGN.md.
---

# Write like the Google developers style guide

This skill is the house standard for prose in this repo. It distills the
Google developers documentation style guide
(https://developers.google.com/style). It is a writing guide, not a code
style guide; code follows the codebase's own conventions, and this skill
governs the English around the code. When a detail is not covered here,
the full guide and its word list
(https://developers.google.com/style/word-list) are the source of truth.

## Scope and precedence

Apply this standard to everything written in Claude's own voice:

- Chat replies and visible thought traces.
- Commit messages, PR titles and bodies, and review comments.
- Repo documentation: README, BACKLOG, SECURITY-STATE, design notes.
- Code comments and developer-facing script output.

Two exceptions take precedence over this skill:

1. **App UI copy.** The product's words (UI strings, the literary
   prompts, the privacy and terms pages) are governed by the
   `snippets-craft` skill, `DESIGN.md`, and the copy-clarity linter. The
   literary register deliberately breaks documentation voice, and the
   technical register is already held to a stricter standard than this
   guide. Don't rewrite app copy to match this skill.
2. **Existing-document consistency.** When you edit a document that
   already follows a different minor convention (for example, the spaced
   em dashes throughout `CLAUDE.md`), match the document. Apply this
   guide fully in new documents and in everything conversational.

## Voice and tone

- Write like a knowledgeable colleague: conversational, friendly, and
  direct. Not chummy, not frivolous, and not formal for its own sake.
- Address the reader as "you". Use "we" rarely, and only for an actual
  authoring group; never use "we" to mean "you and I".
- Use the active voice and name the actor. Use the present tense;
  don't use "will" for behavior that happens when the reader acts.
- Contractions are fine ("it's", "don't"). Exclamation points almost
  never are.
- Don't pre-judge difficulty: no "simply", "just", "easily", "quick",
  "obviously", or "of course".
- Don't use "please" in instructions.
- No marketing language: "powerful", "seamless", "best-in-class".
- Don't anthropomorphize software. A function returns a value; it
  doesn't "want", "think", or "care".

## Requirements and possibility

- State requirements with "must" or an imperative. Use "can" for
  ability and "might" for possibility. Reserve "may" for permission.
- Avoid "should". Say whether the thing is required, recommended (and
  why), or optional.
- Put the condition before the instruction: "If the build fails, read
  the log", not "Read the log if the build fails".

## Word choice

- Use one term per concept, consistently. Don't alternate synonyms for
  variety.
- Spell out an abbreviation at first use, with the short form in
  parentheses: "Content Security Policy (CSP)". Don't coin an
  abbreviation for a term you use twice.
- Prefer plain verbs: "use", not "utilize" or "leverage"; "to", not
  "in order to"; "before", not "prior to"; "lets you", not
  "allows you to".
- Spell out Latin abbreviations: "for example", not "e.g."; "that is",
  not "i.e."; "and so on" (or rework the sentence), not "etc.".
- Avoid "and/or"; write "A, B, or both". Prefer "through" or
  "by using" over "via".
- `word-list.md` in this directory settles the high-traffic terms:
  "email", "filename", "sign in" versus "sign-in", "set up" versus
  "setup", "allowlist", "primary", and more. Check it before improvising.

## Punctuation and mechanics

- Use the serial comma: "sync, backup, and encryption".
- Use sentence case for every heading and title, including Markdown
  headings and commit subjects.
- Close up em dashes—like this—with no surrounding spaces. Use an en
  dash for number ranges.
- Hyphenate compound modifiers before a noun: "a local-first app".
- Use American spelling. Put periods and commas inside quotation marks,
  except around code and literal strings, where the punctuation stays
  outside the quotes.
- One space after a period. Don't use "&" for "and" outside code and
  proper names.

## Structure

- Start a task-based heading with a bare verb: "Create a key", not
  "Creating a key".
- Use a numbered list for a sequence and a bulleted list otherwise.
  Keep items parallel in structure. Capitalize each item, and end an
  item with a period when it is a sentence. Introduce a list with a
  complete sentence that ends in a colon.
- Make link text name its destination: "see the sync protocol", never
  "click here" or a bare "here".
- Bold the exact label of a UI element: "tap **Save**". Use "click"
  with a mouse, "tap" on a touchscreen, and "select" when the input
  method is unknown. Select a checkbox; don't "check" it.
- Use code font for commands, filenames, identifiers, and literal
  values. Write placeholders in caps with underscores (`YOUR_API_KEY`)
  and explain each one at first use.

## Numbers and dates

- Spell out zero through nine; use numerals for 10 and above, and
  always for versions, measurements, and numbers paired with units
  ("3 GB", with a space before the unit).
- Don't start a sentence with a numeral. Use commas in numbers of four
  or more digits: "1,024".
- Write dates as "August 18, 2026". Never use all-numeric dates; they
  read differently across regions.

## Inclusive, accessible, global

- Use the singular "they" for a person of unknown gender. Never infer
  pronouns from a name.
- Use "allowlist" and "blocklist", "primary" and "replica",
  "placeholder data", and "quick check" (not "sanity check").
- Write for a global reader: short sentences with one idea each, no
  idioms, and no humor that depends on one culture.
- Don't refer to a position on the page. Write "the preceding section"
  or link to it, not "above" or "below".
- Give every image alt text that states what matters in it.

## Timeless writing

Avoid "currently", "at this time", "soon", "new", and "in the future".
Name the version or the date instead: "as of Dexie v3", not "the new
schema".

## Thought traces

Visible thinking is working prose, and the reader can see it. Hold it
to the language rules: word choice, tense, voice, precise modals, and
no difficulty judgments. The formatting rules apply when a trace uses
headings or lists. Don't let polishing displace reasoning.

## Before you ship prose

Scan for the frequent misses:

1. Headings are in sentence case, and serial commas are present.
2. No "simply", "just", "easily", "please", "should", "will", "via",
   "e.g.", "i.e.", "etc.", "leverage", "utilize", or "in order to".
3. Second person, active voice, present tense.
4. Conditions come before instructions, and requirements read as
   "must" or an imperative.
5. Link text names its destination, and UI labels are bold and exact.
