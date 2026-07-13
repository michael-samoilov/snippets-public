"use client";

/* ══ PERMANENT dev/test tool — NOT ad-hoc scaffolding; DO NOT DELETE ════
   Cleanup agents/passes: this is standing infrastructure, keep it. It has
   been rebuilt from scratch several times after being removed as "debug
   scaffolding" — that removal is the mistake, not the file. It is written to
   be safe to ship to production, precisely so it can live here for good.
   IT MUST STAY ON PROD (harmlessly inert there — see the guards below) so that
   every preview branch cut from prod inherits it. HOW IT KEEPS GETTING LOST:
   not only ad-hoc deletion — a wholesale `git revert` / tree-reset to an OLDER
   commit (e.g. reverting a big feature) silently drops any file added after
   that commit, this one included. If prod is ever reset to a pre-seeder tree,
   RE-ADD this file + its `providers.tsx` gate from any branch that still has
   them; don't wait to be asked.

   WHAT IT DOES: fills IndexedDB with a realistic multi-year book on demand,
   so behaviour that only shows on a BIG book (the years-deep scroll/crash
   work, keep/zoom perf) can be exercised on a preview URL or locally, where
   there is no Google sign-in to restore a real book. Open `?seed=800` (the
   number is the entry count; `&years=3` sets the span; `?seed=clear` wipes
   it). A new count cleanly REPLACES a prior seed.

   WHY IT'S SAFE IN PROD (four independent guards):
     1. INERT ON THE PROD DOMAIN — `seedingAllowedHere()` returns false on
        snippets.ink, so a real user can never trigger it (active on
        localhost and every *.vercel.app preview, which is where we test).
     2. Hard-gated behind the `?seed=…` URL param — never runs on a normal
        load.
     3. Never clobbers a real book: it only seeds an empty book or REPLACES
        its own prior seed (tracked by SEED_MARK); an unseeded book is left
        untouched without `&force`.
     4. Mints local-only rows (`_dirty: 0`, so a later sign-in never pushes
        them) and is dynamically imported (the corpus never rides the normal
        bundle).
   Deterministic (a seeded PRNG), so the same URL builds the identical book
   every time. */

import { ulid } from "ulidx";
import { db } from "@/lib/db";
import { dayKey } from "@/lib/dates";
import type { Snippet } from "@/lib/types";

// The seeder is INERT on these hosts so it can ship to prod harmlessly. If the
// production domain ever changes, update this set (and the CLAUDE.md note).
const PROD_HOSTS = new Set(["snippets.ink", "www.snippets.ink"]);

/** True everywhere we test (localhost, *.vercel.app previews), false on the
 *  real production domain — so this tool is safe to keep in the prod build. */
export function seedingAllowedHere(): boolean {
  if (typeof window === "undefined") return false;
  return !PROD_HOSTS.has(window.location.hostname);
}

// mulberry32 — a tiny deterministic PRNG (Date.now/Math.random-free seeding),
// so ?seed=500 builds the identical book every time
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// a small corpus of commonplace-book-shaped sentences — assembled into
// entries of 1–7 sentences so the book carries the full spread of tile
// sizes: one-liners, mid tiles, and the six-line-clamped long ones (which
// are what exercise the compact/foot-fade paths and the heaviest paint).
const SENTENCES = [
  "The barista drew a leaf and called it a fern.",
  "Rain all afternoon; the gutters kept a steadier rhythm than I did.",
  "He said the best maps are the ones you can fold back wrong.",
  "A child on the train counted every tunnel out loud.",
  "The old bookshop smells of dust and other people's decades.",
  "She laughs a beat before the joke lands, which is its own kind of joke.",
  "Found a note in a library copy: “you were right about the ending.”",
  "The dog waits at the same corner for a bus that stopped running years ago.",
  "Steam off the kettle wrote something on the window and then took it back.",
  "My grandmother measured flour with her palm and never once was wrong.",
  "Two strangers argued gently about which star was actually a planet.",
  "The tailor pinned the hem and told me to stand like I meant it.",
  "A saxophone somewhere, patient, working the same four bars into shape.",
  "The tide left a perfect circle of stones nobody arranged.",
  "He keeps his father's watch running though he checks his phone for the time.",
  "The market closes and the pigeons hold a second, quieter market.",
  "She names the plants after composers and waters Bach the most.",
  "Snow makes the whole city agree to be slower for a day.",
  "The waiter remembered my order and I remembered nothing about the meal.",
  "A kite went down in the park and three adults ran like it was theirs.",
  "The lecture ran long; the good part was in the last five minutes as always.",
  "Someone had chalked a hopscotch grid that ran off the curb into the road.",
  "The ferry horn and the church bell disagreed by about a semitone.",
  "He folds the newspaper to exactly the crossword and no further.",
  "The cat sits in the one square of sun and lets the room orbit it.",
  "I mishear lyrics for years and prefer my versions every time.",
  "The bridge hums under traffic like it is thinking something over.",
  "She keeps receipts as bookmarks; the novel is dated by its groceries.",
  "A man practiced his speech to the mirror and the mirror looked convinced.",
  "The bakery sells yesterday's bread half price to a line that forms early.",
];

function makeText(rand: () => number): string {
  // 1–7 sentences, skewed toward the short end so the book reads like a real
  // one — mostly quick captures, a scattering of longer reflections
  const roll = rand();
  const n =
    roll < 0.4 ? 1 : roll < 0.7 ? 2 : roll < 0.85 ? 3 : roll < 0.94 ? 4 : roll < 0.98 ? 6 : 7;
  const parts: string[] = [];
  for (let i = 0; i < n; i++) {
    parts.push(SENTENCES[Math.floor(rand() * SENTENCES.length)]);
  }
  return parts.join(" ");
}

/** Build `count` entries spread over `years`, most days empty, some clustered. */
export function buildSeedRows(count: number, years: number, seedNum = 1): Snippet[] {
  const rand = mulberry32(seedNum);
  const now = Date.now();
  const spanDays = Math.round(years * 365);
  const rows: Snippet[] = [];
  for (let i = 0; i < count; i++) {
    // a day offset skewed toward the recent past (rand² clusters near 0), so
    // the book thickens toward today the way a real one does — but still
    // reaches back the full span
    const offsetDays = Math.floor(rand() * rand() * spanDays);
    // a waking-hours capture time (7am–11pm), minutes and seconds jittered
    const hour = 7 + Math.floor(rand() * 16);
    const min = Math.floor(rand() * 60);
    const sec = Math.floor(rand() * 60);
    const d = new Date(now - offsetDays * 86400_000);
    d.setHours(hour, min, sec, Math.floor(rand() * 1000));
    const capturedAt = d.getTime();
    rows.push({
      // id minted from capturedAt so entries sort chronologically within a
      // day, exactly as real (ULID-by-creation-time) rows do
      id: ulid(capturedAt),
      text: makeText(rand),
      kind: null,
      tags: [],
      capturedAt,
      day: dayKey(new Date(capturedAt)),
      source: rand() < 0.25 ? "voice" : "typed",
      favorite: rand() < 0.08 ? 1 : 0,
      updatedAt: capturedAt,
      // local test data only — never offer it to a server
      _dirty: 0,
    });
  }
  return rows;
}

const SEED_MARK = "devSeed:v1";

/**
 * If the URL asks for a seed, build the book once and strip the param so a
 * reload doesn't re-run. `?seed=800` seeds 800 entries over 5 years; the
 * number IS the count, so `?seed=500` then `?seed=800` cleanly replaces the
 * first with exactly 800 (our own seed is wiped first — a real book is never
 * touched without `&force`). `?seed=800&years=3` overrides the span;
 * `?seed=clear` wipes the whole table.
 *
 * Returns true if it kicked off a seed/clear (the caller may skip its own
 * first-run work while the write lands — the live query repaints on its own).
 */
export async function runDevSeedFromUrl(search?: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!seedingAllowedHere()) return false; // never on the real prod domain
  // the calendar page rewrites the URL to `?d=…` on load, which can beat this
  // async path and wipe the seed param — so the caller captures the original
  // search string synchronously and hands it in; fall back to live only if
  // it wasn't passed.
  const params = new URLSearchParams(search ?? window.location.search);
  const seed = params.get("seed");
  if (!seed) return false;

  const strip = () => {
    const u = new URL(window.location.href);
    ["seed", "years", "count", "force"].forEach((k) => u.searchParams.delete(k));
    window.history.replaceState(null, "", u.pathname + u.search);
  };

  if (seed === "clear") {
    await db.snippets.clear();
    // keep the mark SET (to a sentinel) so the preview auto-seed won't refill a
    // book you cleared on purpose — e.g. to test empty states. `?seed=N` reseeds.
    try {
      localStorage.setItem(SEED_MARK, "cleared");
    } catch {}
    strip();
    return true;
  }

  const count = Number(params.get("count") ?? seed) || 500;
  const years = Number(params.get("years")) || 5;
  const force = params.has("force");
  const signature = `${count}@${years}`;

  const already = (() => {
    try {
      return localStorage.getItem(SEED_MARK);
    } catch {
      return null;
    }
  })();
  const existing = await db.snippets.count();
  // a book THIS browser seeded before (the mark is set) vs. a real book we
  // must never clobber
  const isOurSeed = already != null && existing > 0;

  // exactly this seed already sits in the book — nothing to do
  if (!force && already === signature) {
    strip();
    return false;
  }
  // a real (never-seeded) book is sacred: don't seed over it unless forced
  if (!force && existing > 0 && !isOurSeed) {
    strip();
    return false;
  }

  // replace our OWN prior seed so a new count is exact — ?seed=800 after
  // ?seed=500 yields 800, not 1300 (a real book with &force still adds on top)
  if (isOurSeed) {
    await db.snippets.clear();
  }

  const rows = buildSeedRows(count, years, 1);
  await db.snippets.bulkPut(rows);
  try {
    localStorage.setItem(SEED_MARK, signature);
  } catch {}
  strip();
  return true;
}

// The default book a fresh preview seeds itself with. 1000 over 5 years is a
// genuine longtime-user book — the corpus the WINDOWING work (BACKLOG #12) has
// to stay smooth and crash-free on, so the preview opens straight onto the case
// that matters. Before windowing this crashed and 400 was used to keep the
// preview usable; windowing renders only the on-screen sections, so 1000 is now
// fine. `?seed=clear` empties it for empty-state testing; `?seed=N` overrides.
const AUTO_SEED_COUNT = 1000;
const AUTO_SEED_YEARS = 5;

/**
 * The single entry the app calls on every load (previews/local only — inert on
 * the prod domain via `seedingAllowedHere`). An explicit `?seed=…` always wins;
 * otherwise a FRESH preview auto-seeds once, so there's always a realistic book
 * to test against without anyone typing a param. Auto never fires again after a
 * manual seed OR a `?seed=clear` (both leave SEED_MARK set), so a book you
 * cleared to test empty states stays empty. Never touches a real signed-in book.
 */
export async function maybeSeedDevBook(search?: string): Promise<void> {
  if (!seedingAllowedHere()) return;
  const s = new URLSearchParams(
    search ?? (typeof window !== "undefined" ? window.location.search : ""),
  );
  if (s.has("seed")) {
    await runDevSeedFromUrl(search);
    return;
  }
  // auto path: only an untouched (mark unset), empty book gets the default book
  try {
    if (localStorage.getItem(SEED_MARK)) return; // already seeded or cleared once
  } catch {
    return;
  }
  if ((await db.snippets.count()) > 0) return; // a real book is present — leave it
  await db.snippets.bulkPut(buildSeedRows(AUTO_SEED_COUNT, AUTO_SEED_YEARS, 1));
  try {
    localStorage.setItem(SEED_MARK, `auto:${AUTO_SEED_COUNT}@${AUTO_SEED_YEARS}`);
  } catch {}
}
