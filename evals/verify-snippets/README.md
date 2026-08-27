# verify-snippets eval

A repeatable, objective-first eval for the `verify-snippets` skill. It spawns
candidate agents on organic tasks and scores whether each discovered the
skill, ran a real lane, picked the right lane, stayed in scope, and scoped
device-only limits honestly. Most of the score is mechanical, so you can loop
on it without an independent judge model, which this environment does not
have.

## Files

- `prompts.json` — the fixed task set. Positive prompts a user would type,
  with rubric data (`expected_lanes`, `must_scope_device_only`) the scorer
  reads and candidates never see. A negative set that should NOT trigger the
  skill, to measure over-triggering.
- `score.py` — the scorer. Scores one candidate from its sub-agent transcript
  (and optionally its `EVIDENCE_DIR`). No model call.
- `results/` — one JSON per run, plus `baseline.json` (the reference).

## Run it

The run is agent-driven, because spawning candidates is a harness action a
shell script cannot do. Follow the poteto `eval` playbook's blinding rules
(`.claude/skills/poteto-mode/playbooks/eval.md`): the candidate prompt is the
`prompt` field verbatim, with no mention of evals, skills, scoring, or that
other candidates exist.

1. Make sure the app is serving at `http://127.0.0.1:3000` (a production
   build via `webapp-testing`'s `with_server.py`, or `next start`).
2. For each prompt, spawn N candidates with the Agent tool, `subagent_type:
   general-purpose`, `isolation: worktree`, `run_in_background: true`. Give
   each the prompt verbatim. Capture each returned `agentId`.
   - For N > 1 on the same prompt, tell each candidate to `export
     EVIDENCE_DIR=/tmp/verify-snippets-eval/<run>/<agentId>` so their
     evidence dirs do not collide. For N = 1, the default is fine and the
     scorer reads the transcript anyway.
3. When a candidate finishes, score it:

   ```sh
   python3 evals/verify-snippets/score.py \
     --prompt-id <id> \
     --transcript /root/.claude/projects/-home-user-snippets/<sessionId>/subagents/agent-<agentId>.jsonl \
     [--evidence /tmp/verify-snippets-eval/<run>/<agentId>] \
     [--worktree <candidate-worktree>]
   ```

   The `<sessionId>` is this session's, the parent that spawned the
   candidates. The transcript path is Claude-Code-specific; capture the
   `agentId` at spawn time to locate it.
4. Aggregate the per-candidate totals to a mean per prompt and write
   `results/<YYYY-MM-DD-HHMM>.json`. Compare to `baseline.json`.

`aggregate.py` does step 3-4 in one call once all candidates have finished.
It maps each sub-agent transcript back to its prompt from the `description`
you gave the candidate (start the description with the prompt id), scores each
with `score.py`, and writes the aggregated result. Run it only after every
candidate is done, since it scores whatever transcript exists, including a
partial one:

```sh
python3 evals/verify-snippets/aggregate.py --label <YYYY-MM-DD>-usage \
  [--session-id <thisSessionId>] [--evidence-root /tmp/vs-eval/<run>]
```

## What the score means

Per positive candidate, criteria in `[0,1]`, weighted:

- `discovered` (0.15) — read `SKILL.md` or invoked a skill script.
- `executed` (0.25) — a real lane ran, proven by a `PASS`/`FAIL` verdict in a
  Bash `tool_result` and/or a populated `EVIDENCE_DIR/<lane>/`.
- `right_lane` (0.20) — the lanes run cover the ones the claim needs
  (`expected_lanes`).
- `in_scope` (0.15) — the candidate worktree has no `src/` edits.
- `honest_scoping` (0.25) — the final report names device-only limits
  (momentum, jetsam, 60fps, install) and does not claim iOS truth from a
  sandbox run. This is the one heuristic slice; a model-judge hook is marked
  in `score.py`.

A negative candidate scores `not_over_triggered` (0.8) plus `in_scope` (0.2):
firing a browser lane on a non-matching prompt is the failure.

`baseline.json`: a strong run scores ~0.93-1.0, a faked run <0.2, an
over-trigger 0.2.

## Hillclimb loop

1. Record the baseline (done: `baseline.json`).
2. Change the skill (its `SKILL.md`, a persona, a lane).
3. Re-run the same prompts, same N.
4. Keep the change only if the mean objective score rises, one commit per
   accepted win, with a one-line decision note (the poteto Hillclimb
   playbook).

## Standing caveats, read before trusting a curve

- **Noise.** Agent behavior is stochastic. N must be large enough for signal
  over noise; a one-candidate delta is not a result. Budget tokens for it.
- **Overfitting.** The positive prompts are a training set. Hold some prompts
  out of the loop and check them only at the end, or you tune the skill to
  the eval rather than to reality.
- **Judge independence.** `honest_scoping` correlates with whoever wrote the
  skill. Keep it advisory and hillclimb the objective criteria until an
  independent judge model is configured (`setup-pstack` + a different model
  family), then swap it in at the hook in `score.py`.
