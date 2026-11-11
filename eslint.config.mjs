import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored third-party sources (Paper Shaders) — not ours to lint.
    "src/vendor/**",
    // Vendored oxlint rules (anti-slop) — same rule; oxlint ignores them too.
    "tools/oxlint/anti-slop/**",
    // Agent tooling (vendored pstack skills and their Bun scripts) — not
    // app code; flat config lints dot-directories unless told otherwise.
    ".claude/**",
  ]),
]);

export default eslintConfig;
