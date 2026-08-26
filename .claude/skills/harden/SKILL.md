---
name: harden
description: Turn observed agent failure modes into build-failing guards. Scan recent session transcripts, git history, and PR review threads for corrections that recur, then propose targeted checks that fail `pnpm test` so the same mistake cannot merge again. Use for /harden, "encode this lesson", "add a guard for X", or a periodic pass after a stretch of agent work. The self-updating half of principle "encode lessons in structure".
---

# Harden

Coding agents repeat the failure modes that fit their context: copy the
nearest pattern, take the shortest path that compiles, restate an invariant
as a long comment instead of a check. A prose rule in `CLAUDE.md` relies on
the next agent noticing it. A build-failing guard does not. This skill
closes the loop: observed failure to mechanical guard, without a human
writing the rule.

This specializes the `reflect` skill toward one output — a check that fails
CI — rather than general skill edits. Read `principle-encode-lessons-in-structure`
before running; it defines the rung ladder this skill climbs.

## Where guards live

- `src/lib/agent-footguns.test.ts` — the append-only registry for agent
  slop and this repo's non-security "deleted things stay deleted" invariants.
  Most new guards go here.
- `src/lib/security-invariants.test.ts` — the no-plaintext / encryption
  invariants. Security guards go here.
- `src/lib/copy-clarity.test.ts` — technical-copy voice.
- `tools/oxlint/anti-slop/rules/*.ts` — low-evidence TypeScript (advisory,
  `pnpm lint:slop`). Use only when a check is genuinely an AST rule and a
  test cannot express it; the tests are the build gate, oxlint is not.

## The one discipline: targeted, never blanket

This repo's invariants are semantic, not lexical. The same construct is
correct in one file and forbidden in another: `db.snippets.put` in the sync
engine versus a component, `clear()` in the dev seed versus an erase-all on
a synced book, a long comment in a component versus the FLAT-BOOK LAW in
`globals.css`. So a blanket ban on the token flags correct code, and a
flagged-but-correct guard trains the next agent to disable it. Every rule
scans the specific files and the pattern-in-context that is always wrong —
the way the security guard matches `disableEncryption\s*[(=]` (a definition
or call), not the word. If you cannot express the rule without false
positives, it is prose, not a guard; make the `CLAUDE.md` line more
prominent instead.

## Steps

1. **Gather evidence, this workspace only.** Read recent session transcripts
   under `~/.claude/projects/<encoded-cwd>/*.jsonl` for this repo (never glob
   across `~/.claude/projects/` — that reads unrelated projects). Add `git
   log` for revert / "fix" / "actually" commits and any PR review threads.
   The signal is a correction that recurs, or an invariant a human restated.
2. **Classify each candidate** per encode-lessons-in-structure. A one-off is
   a note, not a rule. A recurring fix earns a guard. A systemic issue is a
   principle or a type that makes the state unrepresentable.
3. **Pick the strongest rung the case allows.** Unrepresentable state that
   cannot compile beats a build-failing guard, which beats a canonical
   helper, which beats a runtime check, which beats prose. Prefer a guard in
   the files above.
4. **Draft the rule targeted, and prove it both ways.** It must pass on
   current `HEAD` and fail on the real violation. Plant the violation in a
   throwaway file, run the guard, watch it fail with a message that names the
   offending file and says what to do, then remove the plant and confirm
   green. A guard you only watched pass is unproven.
5. **Open one PR** with the additions, each carrying its clean-and-violation
   proof in the description, for human review. Never auto-merge a guard;
   a wrong guard blocks everyone. When you add a guard that replaces a
   `CLAUDE.md` "do NOT" line, delete the prose in the same PR — the
   instruction was the symptom.

## Reply

Name each failure mode you found and where the evidence was, the rung you
chose and why, and the guard you propose with its two-way proof. If a
candidate did not earn a guard, say so and where it went instead.
