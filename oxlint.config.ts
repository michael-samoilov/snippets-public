import { defineConfig } from "oxlint";

// anti-slop (github.com/dmmulroy/anti-slop, MIT — LICENSE sits beside
// the rules) — VENDORED, not a dependency: the sources live in
// tools/oxlint/anti-slop and are ours to edit, same rule as
// src/vendor/paper-shaders. Rules reject low-evidence TypeScript —
// `unknown` parameters, chained assertions, `object` as a type, runtime
// `typeof` where a boundary parse belongs.
//
// Oxlint runs ALONGSIDE eslint: `pnpm lint` (eslint) stays the build
// gate, `pnpm lint:slop` is this. Vendored 2026-08 from the upstream
// installer skill; to pull a newer copy, re-run
//   npx skills add dmmulroy/anti-slop --skill install-anti-slop
// then diff its assets/anti-slop against tools/oxlint/anti-slop and
// keep any local edits. Bump oxlint and @oxlint/plugins together —
// they must match versions.
export default defineConfig({
  ignorePatterns: [
    // Build output (mirrors eslint.config.mjs).
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party sources — not ours to lint.
    "src/vendor/**",
    "tools/oxlint/anti-slop/**",
    // Agent tooling: installed skills/hooks are not application source.
    ".agents/**",
    ".claude/**",
  ],
  jsPlugins: [
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
  ],
  // Oxlint's own rule set is off: eslint (`pnpm lint`) is this repo's
  // general linter, and two overlapping ones is how a lint report stops
  // being read. This command reports anti-slop and nothing else.
  categories: { correctness: "off" },
  rules: {
    // ERROR — the codebase is already clean here (0 findings as of the
    // 2026-08 install), so these cost nothing and hold the line.
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-reflect-get": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-widen-then-assert": "error",

    // WARN — existing findings, counted in the install commit. Promote a
    // rule to "error" once its backlog is cleared; that is the only way
    // these ever stop being wallpaper.
    "anti-slop/require-safety-comment-for-type-assertion": "warn", // 115
    "anti-slop/no-runtime-typeof": "warn", // 80
    "anti-slop/no-known-value-widening": "warn", // 29
    "anti-slop/no-unknown-parameters": "warn", // 12
    "anti-slop/no-conditional-empty-object-spread": "warn", // 8
    "anti-slop/no-unsafe-dictionary-type": "warn", // 7
    "anti-slop/no-chained-type-assertions": "warn", // 5
    "anti-slop/no-module-mocking": "warn", // 3
    "anti-slop/no-unknown-returns": "warn", // 2
    "anti-slop/no-shape-in-symbol-names": "warn", // 2
  },
});
