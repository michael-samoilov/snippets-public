---
name: turn-report
description: The owner's standing report contract—the reply that closes every work turn answers five questions before they are asked: what changed and whether it is merged, how each change was measured (never inferred), the trade-offs, a side-by-side view, and what needs manual testing. A SessionStart hook injects it automatically; load it manually if it is not in context. Composes with action-first-replies (reply shape) and google-style (sentences).
---

# Close every work turn with the owner's report

The owner's follow-up to a work turn is always the same five questions,
so the turn's closing reply answers them before they are asked. A turn
that changed nothing (a question answered, an investigation reported)
skips the template: answer concisely and stop.

## The five slots, in order

Keep the whole report under about 150 words plus attachments. Detail
lives in commit messages and attached files, not in the reply.

1. **Changed + merge state.** One or two sentences: what changed, at
   which commit. Then the merge line. "Main" here means the production
   branch `claude/nice-dijkstra-q7d285` (this repo has no `main`);
   state "merged" or name the one blocker. CLAUDE.md authorizes merging
   finished work without asking, so an unmerged turn needs a stated
   reason.
2. **How it was verified.** Per change: the root-cause test (name it)
   or the harness measurement (screenshots, recordings, DOM and state
   readouts—see "Prove the fix" in CLAUDE.md). Report what was
   measured, not what the code implies. Label anything you could not
   measure "unverified", with the reason. Never dress inference up as
   measurement.
3. **Trade-offs.** One or two sentences on before versus after: what
   the chosen approach costs, and what the rejected one would have
   cost. When the change has no real alternative (a typo, a version
   bump), write "none".
4. **Side-by-side.** The owner reviews from the reply, not from a
   preview deploy. For a UI change, attach before and after screenshots
   side by side (SendUserFile), captured at the viewports and themes in
   "Visual verification" in CLAUDE.md; composite them into one image
   when possible. For a behavior change with no visual surface, give a
   small table of the observable behavior before and after. When
   nothing observable changed, one line says so.
5. **Manual test.** Only what genuinely needs the owner's hands or
   device (the second-priority handoff in "Prove the fix"): numbered,
   literal steps—the exact branch or URL, the exact taps, and the
   expected observation as an unambiguous yes or no. Otherwise write
   "Nothing to test manually."

## Rules of the report

- The slots keep this order every time, so the owner can skim by
  position.
- Every slot appears, even as one line ("none", "nothing to test
  manually"). An absent slot reads as an unanswered question.
- Mid-task progress replies don't carry the template; the turn's
  closing reply does.
- If the report runs long, cut detail from slots 1 and 3 first. Never
  cut from slots 2 and 5, and never shorten by softening "unverified".
