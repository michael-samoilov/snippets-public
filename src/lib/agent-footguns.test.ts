/**
 * The agent-footgun guard — an append-only registry of mechanical checks
 * for the failure modes coding agents fall into in THIS repo. It rides
 * `pnpm test`, so a violation fails the build and cannot merge. This is the
 * structural half of principle "encode lessons in structure": when a review
 * catches the same agent mistake twice, add a rule here instead of another
 * line of prose nobody re-reads.
 *
 * ONE discipline governs every rule: it must be TARGETED, not a blanket
 * lexical ban. This repo's invariants are semantic — the same construct is
 * correct in one file and forbidden in another. `db.snippets.put` is right
 * in the sync engine and wrong in a component; `clear()` is right in the dev
 * seed and wrong as the erase-all path on a synced book; a long comment is
 * slop in a component and the FLAT-BOOK LAW in globals.css. So a rule scans
 * the specific files and the specific pattern-in-context that is always
 * wrong, the way the security guard matches `disableEncryption\s*[(=]` (a
 * definition or call) rather than the word itself. A blanket ban that flags
 * correct code is worse than no rule: it trains the next agent to disable it.
 *
 * Rules that do NOT fit this file: security invariants live in
 * security-invariants.test.ts; copy voice lives in copy-clarity.test.ts;
 * low-evidence TypeScript is oxlint anti-slop (`pnpm lint:slop`).
 *
 * The /harden skill proposes additions here from observed corrections.
 */
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (f: string) => f.slice(SRC.length);
const nonTest = (f: string) => !/\.test\.tsx?$/.test(f);

describe("agent-footgun guards", () => {
  it("no focused tests are committed", () => {
    const offenders = sourceFiles(SRC).filter((f) =>
      /\b(?:describe|it|test)\.only\s*\(/.test(readFileSync(f, "utf8")),
    );
    expect(
      offenders.map(rel),
      "a `.only` test silently disables every other test in its file, " +
        "including the guards below — remove the focus before committing.",
    ).toEqual([]);
  });

  it("no debugger statements are left in source", () => {
    const offenders = sourceFiles(SRC).filter((f) =>
      /(?:^|;|\s)debugger\s*;/.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map(rel), "a stray `debugger` breaks production.").toEqual([]);
  });

  it("the removed enrichment feature stays removed", () => {
    // Enrichment (auto title/kind/tags) was retired 2026-07. The route and
    // module must not return. The `enriched` FIELD is exempt: it survives on
    // the model and its one-time strip-on-read migration in db.ts, so this
    // guards the route and module, not a mention of the field.
    const revived = [
      "app/api/enrich",
      "app/api/enrich/route.ts",
      "lib/enrich.ts",
    ].filter((p) => existsSync(join(SRC, p)));
    const callers = sourceFiles(SRC)
      .filter(nonTest)
      .filter((f) => /fetch\(\s*['"`]\/api\/enrich/.test(readFileSync(f, "utf8")));
    expect(
      [...revived, ...callers.map(rel)],
      "enrichment was retired 2026-07 — entries are their words alone; " +
        "do not reintroduce the /api/enrich route, enrich.ts, or a caller.",
    ).toEqual([]);
  });
});
