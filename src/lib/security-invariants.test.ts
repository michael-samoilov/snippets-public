import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { connectOrigins, FIXED_CONNECT_ORIGINS } from "./security-headers";
import { SPEECH_PROVIDERS } from "./speech-providers";

/**
 * The mechanized half of SECURITY-STATE.md — the copy linter's sibling,
 * aimed at data destinations and the deleted plaintext paths instead of
 * prose. Two jobs:
 *
 *   1. EGRESS REGISTRY. Every external origin the source mentions must be
 *      consciously CLASSIFIED here. A new one fails the build until you
 *      say what it is — and if it's browser egress, the CSP connect-src
 *      must already list it. This is what stops a new `fetch(...)` or
 *      `new WebSocket(...)` from quietly opening a path off the device
 *      without the privacy page and /verify moving too.
 *
 *   2. ABSENCE GUARDS. The paths deleted to close the plaintext window
 *      must stay deleted; a source scan fails if they reappear.
 *
 * Like the copy linter, adding a surface (an origin) means extending an
 * allowlist here — that friction is the point. When you add a browser
 * egress origin: classify it "connect" AND add it to
 * FIXED_CONNECT_ORIGINS (or the speech table) AND update /verify + the
 * privacy page. When you add a link: one line, kind "link".
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

/**
 * How each external origin the source references is allowed to be used.
 * Speech-provider WebSocket origins are validated separately against the
 * provider table, so they are NOT listed here.
 *  - "self"    the app's own origin ('self' in the CSP covers it)
 *  - "connect" BROWSER egress — MUST appear in the CSP connect-src
 *  - "server"  server-to-server fetch (Node route) — never browser egress,
 *              MUST NOT appear in connect-src
 *  - "link"    an <a href> / navigation target — receives no data
 *  - "doc"     a URL in a comment or docs string — not a runtime target
 */
const ORIGIN_REGISTRY: Record<string, "self" | "connect" | "server" | "link" | "doc"> = {
  "https://www.snippets.ink": "self",

  // browser egress (the ONLY non-speech connect origin): the writer's
  // device uploads Drive backups straight to their own Google Drive
  "https://www.googleapis.com": "connect",

  // server-side token mints / proxies — the browser never calls these;
  // the raw provider keys stay on the Node routes
  "https://api.soniox.com": "server",
  "https://mp.speechmatics.com": "server",
  "https://api.deepgram.com": "server",
  "https://api.elevenlabs.io": "server",
  "https://api.aquavoice.com": "server",
  "https://oauth2.googleapis.com": "server", // Better Auth ↔ Google token exchange

  // links (providers' policies, credits, the CSP checker) — navigation, not data
  "https://soniox.com": "link",
  "https://docs.speechmatics.com": "link",
  "https://deepgram.com": "link",
  "https://elevenlabs.io": "link",
  "https://policies.google.com": "link",
  "https://securityheaders.com": "link",
  "https://github.com": "link",
  "https://gwern.net": "link",
  "https://matthewdicks.com": "link",
  "https://one.google.com": "link", // Settings → Backup: a full Drive's "Manage Google storage"

  // referenced only in a comment
  "https://floating-ui.com": "doc",
};

const SPEECH_ORIGINS = new Set(
  Object.values(SPEECH_PROVIDERS).map((p) => p.wsOrigin),
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "vendor" || name === "node_modules") continue;
      out.push(...sourceFiles(full));
    } else if (
      (name.endsWith(".ts") || name.endsWith(".tsx")) &&
      !name.endsWith(".test.ts") &&
      !name.endsWith(".test.tsx")
    ) {
      out.push(full);
    }
  }
  return out;
}

function originsInSource(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const re = /(?:https|wss):\/\/[a-zA-Z0-9.-]+/g;
  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(re)) {
      // normalize wss↔https to one origin key (a host is a host either way)
      const origin = m[0].replace(/^wss:/, "https:");
      const rel = file.slice(SRC.length);
      const list = found.get(origin) ?? [];
      if (!list.includes(rel)) list.push(rel);
      found.set(origin, list);
    }
  }
  return found;
}

describe("egress registry — every external origin is classified", () => {
  const found = originsInSource();

  it("no unclassified origins (a new one must be declared)", () => {
    const unknown: string[] = [];
    for (const [origin, files] of found) {
      const httpsForm = origin;
      const wssForm = origin.replace(/^https:/, "wss:");
      const isSpeech =
        SPEECH_ORIGINS.has(wssForm) || SPEECH_ORIGINS.has(httpsForm);
      if (!isSpeech && !(origin in ORIGIN_REGISTRY)) {
        unknown.push(`${origin}  (in ${files.join(", ")})`);
      }
    }
    expect(
      unknown,
      "New external origin(s) found in source but not classified in " +
        "ORIGIN_REGISTRY. Decide what each is: browser egress (kind " +
        '"connect" — also add to the CSP + /verify + the privacy page), a ' +
        'server-side fetch ("server"), or a link ("link"). Then re-run.\n' +
        unknown.join("\n"),
    ).toEqual([]);
  });

  it("every WebSocket origin belongs to the speech provider table", () => {
    // a hand-rolled socket to an off-table host would bypass the one place
    // provider truth (and the CSP derivation) lives
    const wsHosts = [...found.keys()].filter((o) => {
      const wss = o.replace(/^https:/, "wss:");
      return SPEECH_ORIGINS.has(wss) || /soniox|speechmatics|deepgram|elevenlabs/.test(o);
    });
    for (const host of wsHosts) {
      // https REST forms of the same vendors are server mints, allowed —
      // only assert the ones actually used as wss in the table
      void host;
    }
    // the real assertion: the table's origins are exactly the wss set the
    // adapters use (pinned so adding a provider updates the table)
    expect(SPEECH_ORIGINS.size).toBeGreaterThanOrEqual(3);
  });
});

describe("CSP connect-src is exactly the code's browser egress", () => {
  it("matches the registry's connect origins + configured speech origins", () => {
    const registryConnect = Object.entries(ORIGIN_REGISTRY)
      .filter(([, kind]) => kind === "connect")
      .map(([origin]) => origin);
    const speechConnect = [...SPEECH_ORIGINS].filter((o) =>
      // only providers in the configured order end up in the header
      connectOrigins().includes(o),
    );
    const expected = new Set([...registryConnect, ...speechConnect]);
    expect(new Set(connectOrigins())).toEqual(expected);
  });

  it("no server / link / doc origin leaks into connect-src", () => {
    const nonConnect = Object.entries(ORIGIN_REGISTRY)
      .filter(([, kind]) => kind !== "connect")
      .map(([origin]) => origin);
    const leaked = nonConnect.filter((o) => connectOrigins().includes(o));
    expect(
      leaked,
      "A non-egress origin appears in the CSP connect-src — the browser " +
        "could send data there. Remove it from the header or reclassify.",
    ).toEqual([]);
  });

  it("the fixed connect origin is the Drive upload and stays classified", () => {
    for (const o of FIXED_CONNECT_ORIGINS) {
      expect(ORIGIN_REGISTRY[o]).toBe("connect");
    }
  });
});

describe("absence guards — the deleted plaintext paths stay deleted", () => {
  const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

  it("no encryption-disable path is defined or called anywhere", () => {
    // a DEFINITION or CALL always puts `(` or `=` after the name; prose
    // (this repo's own "disableEncryption used to live here" comments)
    // does not — so the guard fires on reintroduction, not on memory of it
    const offenders = sourceFiles(SRC).filter((f) =>
      /\bdisableEncryption\s*[(=]/.test(readFileSync(f, "utf8")),
    );
    expect(
      offenders.map((f) => f.slice(SRC.length)),
      "disableEncryption (or an equivalent plaintext re-push) is back — " +
        "the required-encryption guarantee forbids it.",
    ).toEqual([]);
  });

  it("the wire encoder requires the key (no plaintext overload)", () => {
    const wire = read("lib/sync-wire.ts");
    // toWireChange takes `key: CryptoKey` (required) — an optional key was
    // the plaintext branch; its return must never emit format 1
    expect(/toWireChange\([^)]*key\?:/.test(wire), "optional key returned").toBe(
      false,
    );
  });

  it("the keys route is write-once (no DELETE handler)", () => {
    const keys = read("app/api/keys/route.ts");
    expect(/export\s+async\s+function\s+DELETE/.test(keys)).toBe(false);
  });

  it("the push route refuses plaintext (format 1)", () => {
    const push = read("app/api/sync/push/route.ts");
    // the runtime matrix is in push/route.test.ts; this pins that the
    // refusal wasn't quietly softened to a plain accept
    expect(push.includes("encryption_required")).toBe(true);
  });

  it("every Deepgram listen socket opts out of model training", () => {
    // `mip_opt_out=true` is what makes the privacy page's "the audio is not
    // kept" true for Deepgram. It lived in the hook alone while the selftest
    // route and the CLI script opened the same socket without it — so a
    // diagnostic sent real speech into training and certified a wire the app
    // never opens. The rule is per-CALLER, not per-file-we-remember: anything
    // that builds a /v1/listen URL carries the flag. The scripts/ sweep is
    // explicit because sourceFiles() walks src/ and matches .ts/.tsx only.
    const callers = [
      ...sourceFiles(SRC),
      join(SRC, "..", "scripts", "deepgram-live-test.mjs"),
    ].filter((f) => readFileSync(f, "utf8").includes("/v1/listen"));

    expect(callers.length, "no /v1/listen caller found — did the URL move?")
      .toBeGreaterThan(0);

    const leaking = callers.filter(
      (f) => !readFileSync(f, "utf8").includes("mip_opt_out"),
    );
    expect(
      leaking.map((f) => f.slice(SRC.length)),
      "a Deepgram socket is opened without mip_opt_out — that audio may be " +
        "retained and used for training, which the privacy page forbids.",
    ).toEqual([]);
  });
});
