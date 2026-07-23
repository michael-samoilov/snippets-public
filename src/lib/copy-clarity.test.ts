/**
 * The copy clarity linter — STE-informed (ASD-STE100) checks over the app's
 * TECHNICAL register only (privacy, terms, and the settings status/description
 * copy), never the literary register (prompts, "Kept.", the intro). It rides
 * `pnpm test`, so a transgression fails the suite.
 *
 * Errors (fail the build) are high-confidence and low-false-positive:
 *   • banned / inconsistent terms — the voice laws' word choices, mechanised
 *     (encrypt not seal; no "commonplace book"; no internal jargon in status copy);
 *   • vague quantifiers where we've committed to a concrete figure.
 * Warnings (printed, don't fail) are the fuzzier STE guidance — over-long
 * sentences — surfaced for a human to weigh, not enforced blindly.
 *
 * Scope is an explicit allowlist (TECH_COPY_PATHS + PAGES): add a technical
 * surface here when you write one. The literary copy is deliberately exempt.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { copy } from "./copy";

// ── scope ────────────────────────────────────────────────────────
// dotted paths into `copy` whose strings are the technical register
const TECH_COPY_PATHS = [
  "settings.sync",
  "settings.encryption",
  "settings.backup",
  "settings.data",
  "settings.agreement",
  "settings.protection",
  "settings.account",
  "settings.danger",
  "settings.erase",
  "todayZone.locked",
  "todayZone.needsSetup",
  "welcome",
] as const;

const PAGES = [
  "../app/privacy/page.tsx",
  "../app/terms/page.tsx",
  "../app/verify/page.tsx",
  // not a page, but its retention lines render verbatim ON the privacy
  // page — they carry the same register and ride the same bar
  "../lib/speech-providers.ts",
] as const;

// ── the standard, as rules ───────────────────────────────────────
// forbidden → why. Word-boundary, case-insensitive. "wax seal" (the real
// on-screen object, law 7) is exempted before these run.
const BANNED_EVERYWHERE: { re: RegExp; msg: string }[] = [
  { re: /\bcommonplace book\b/i, msg: `"commonplace book" is retired — say "entries" / "notebook"` },
  { re: /\bseal(ed|ing|s)?\b/i, msg: `"seal" as a stand-in for encrypt — say "encrypt" / "encrypted"` },
  { re: /\bnow and then\b/i, msg: `vague cadence — name the interval (e.g. "every 15 minutes")` },
  { re: /\bfrom time to time\b/i, msg: `vague cadence — name the interval` },
  { re: /\bevery so often\b/i, msg: `vague cadence — name the interval` },
  { re: /\bonce in a while\b/i, msg: `vague cadence — name the interval` },
  { re: /\bperiodically\b/i, msg: `vague cadence — name the interval` },
];
// internal / implementation words that must never reach the settings status
// copy (the pages may DEFINE technical terms deliberately, so this is copy-only)
const JARGON_COPY_ONLY: { re: RegExp; msg: string }[] = [
  { re: /\bpayload\b/i, msg: `internal term "payload"` },
  { re: /\btombstone\b/i, msg: `internal term "tombstone"` },
  { re: /\bidempotent\b/i, msg: `internal term "idempotent"` },
  { re: /\bcursor\b/i, msg: `internal term "cursor"` },
  { re: /\bLWW\b/, msg: `internal term "LWW"` },
  { re: /\badvisory lock\b/i, msg: `internal term "advisory lock"` },
  { re: /\bmutex\b/i, msg: `internal term "mutex"` },
];
const SENTENCE_WORD_LIMIT = 28; // STE descriptive cap (~25), a little slack

// ── extraction ───────────────────────────────────────────────────
type Item = { where: string; text: string; scope: "copy" | "page" };

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

// collect every user-facing string under a node: strings as-is; functions
// called with harmless placeholders (they only build sentences); arrays/objects
// recursed. Resilient — a function that throws on the placeholder is skipped.
function collectStrings(node: unknown, acc: string[]): void {
  if (typeof node === "string") acc.push(node);
  else if (typeof node === "function") {
    try {
      const out = (node as (...a: unknown[]) => unknown)(
        ...Array((node as { length: number }).length).fill(3),
      );
      if (typeof out === "string") acc.push(out);
      else if (Array.isArray(out)) out.forEach((s) => typeof s === "string" && acc.push(s));
    } catch {
      /* arity/type mismatch — nothing to lint from this one */
    }
  } else if (Array.isArray(node)) node.forEach((n) => collectStrings(n, acc));
  else if (node && typeof node === "object")
    Object.values(node).forEach((n) => collectStrings(n, acc));
}

function copyItems(): Item[] {
  const items: Item[] = [];
  for (const path of TECH_COPY_PATHS) {
    const acc: string[] = [];
    collectStrings(getByPath(copy, path), acc);
    for (const text of acc) items.push({ where: `copy.${path}`, text, scope: "copy" });
  }
  return items;
}

function pageItems(): Item[] {
  const items: Item[] = [];
  for (const rel of PAGES) {
    const abs = fileURLToPath(new URL(rel, import.meta.url));
    if (!existsSync(abs)) continue;
    const src = readFileSync(abs, "utf8");
    // JSXText only: text sitting between a tag close `>` and the next `<`,
    // never inside {expressions} — so JS code and prop values aren't scanned.
    for (const m of src.matchAll(/>\s*([^<>{}]+?)\s*</g)) {
      const text = m[1].replace(/&rsquo;|&lsquo;/g, "'").replace(/&ldquo;|&rdquo;/g, '"').trim();
      if (text.length > 2 && /[a-z]/i.test(text))
        items.push({ where: rel.replace("../app/", "").replace("/page.tsx", ""), text, scope: "page" });
    }
  }
  return items;
}

function wordsPerSentence(text: string): number[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s.split(/\s+/).length);
}

// ── the lint ─────────────────────────────────────────────────────
describe("copy clarity — STE-informed checks on the technical register", () => {
  const items = [...copyItems(), ...pageItems()];

  it("collects technical copy to lint (sanity)", () => {
    expect(items.length).toBeGreaterThan(30);
  });

  it("uses no banned or inconsistent terms, and no vague cadence", () => {
    const errors: string[] = [];
    for (const { where, text, scope } of items) {
      const hay = text.replace(/\bwax seal\b/gi, "«object»"); // the real object is exempt
      for (const { re, msg } of BANNED_EVERYWHERE)
        if (re.test(hay)) errors.push(`[${where}] ${msg}\n    “${text}”`);
      if (scope === "copy")
        for (const { re, msg } of JARGON_COPY_ONLY)
          if (re.test(text)) errors.push(`[${where}] ${msg}\n    “${text}”`);
    }
    if (errors.length) throw new Error(`copy clarity — ${errors.length} issue(s):\n\n${errors.join("\n\n")}`);
    expect(errors).toEqual([]);
  });

  // advisory: over-long sentences (STE ~25 words). Printed, not enforced —
  // some long lines are honestly clearer whole; a human decides.
  it("flags over-long sentences (advisory)", () => {
    const longOnes: string[] = [];
    for (const { where, text, scope } of items) {
      if (scope !== "copy") continue; // page JSXText fragments split unreliably
      for (const n of wordsPerSentence(text))
        if (n > SENTENCE_WORD_LIMIT) longOnes.push(`[${where}] ${n} words: “${text}”`);
    }
    if (longOnes.length)
      console.warn(
        `\n⚠ copy clarity — ${longOnes.length} long sentence(s) (>${SENTENCE_WORD_LIMIT} words), consider splitting:\n` +
          longOnes.join("\n"),
      );
    expect(true).toBe(true);
  });
});
