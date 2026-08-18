---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases. Vendored from github.com/mattpocock/skills (MIT). Composes with action-first-replies (reply shape) and google-style (sentences).
license: MIT
---

# Grilling

## House integration

Vendored from https://github.com/mattpocock/skills
(`skills/productivity/grilling/SKILL.md`, MIT; LICENSE alongside, same
vendoring rule as `src/vendor/paper-shaders`). Ours to edit. The
`grill-me` skill in this repo is upstream's companion stub: it disables
model invocation, so `/grill-me` is the explicit way in, and this
skill's description is what triggers automatically. How it fits this
repo's standards:

- **Not injected at session start.** Unlike `google-style`,
  `action-first-replies`, and `turn-report`, this skill loads only when you ask
  for it or say a "grill" phrase.
- **Composes with `google-style` and `action-first-replies`.** Those govern the
  sentences and the reply's shape; this one governs the interview's
  structure. The question format below is this skill's own, and it
  wins over the general reply shape while a grilling round is running.
- **The design constitution still rules.** A grilling session about
  UI, copy, or motion answers to `snippets-craft` and `DESIGN.md`;
  `BACKLOG.md` items are already decided and aren't up for
  re-litigation in a round.

From here down, the text is upstream's, verbatim.

## The interview

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Each question should be formatted like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
