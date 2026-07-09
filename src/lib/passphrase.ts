"use client";

/**
 * Passphrase strength, checked at enrollment only. The book key is
 * wrapped under the passphrase and that wrapped copy rests on the
 * server, so a guessable passphrase is the one realistic way an
 * offline attacker — or the operator — could brute-force their way to
 * the key in spite of the 600k PBKDF2 rounds. zxcvbn's dictionary and
 * pattern model predicts real-world guessability far better than
 * character-class entropy (which wildly overrates human choices), and
 * it loads lazily so it never weighs on the main bundle.
 */

export interface PassphraseStrength {
  /** zxcvbn's 0 (trivial) … 4 (very unguessable) */
  score: 0 | 1 | 2 | 3 | 4;
  /** at or above MIN_SCORE the book may be sealed */
  ok: boolean;
}

/**
 * The floor. zxcvbn ties score 3 to "safely unguessable: moderate
 * protection from an offline slow-hash attack (10^10 guesses)", which
 * is exactly our threat model given PBKDF2's slow hash — so 3 is the
 * refuse-below line, and 4 is what the copy nudges toward.
 */
export const MIN_SCORE = 3;

type Zxcvbn = (pass: string, inputs?: (string | number)[]) => { score: number };
let checker: Zxcvbn | null = null;

async function loadChecker(): Promise<Zxcvbn> {
  if (checker) return checker;
  const [core, common, en] = await Promise.all([
    import("@zxcvbn-ts/core"),
    import("@zxcvbn-ts/language-common"),
    import("@zxcvbn-ts/language-en"),
  ]);
  const factory = new core.ZxcvbnFactory({
    dictionary: { ...common.dictionary, ...en.dictionary },
    graphs: common.adjacencyGraphs,
    translations: en.translations,
  });
  checker = (pass, inputs) => factory.check(pass, inputs);
  return checker;
}

/**
 * `userInputs` are strings the guesser would try first — the account's
 * email and its local part — so a passphrase built from them scores low.
 */
export async function checkPassphrase(
  pass: string,
  userInputs: string[] = [],
): Promise<PassphraseStrength> {
  const fn = await loadChecker();
  const raw = fn(pass, userInputs).score;
  const score = Math.max(0, Math.min(4, raw)) as 0 | 1 | 2 | 3 | 4;
  return { score, ok: score >= MIN_SCORE };
}
