/**
 * The real classifyBackupError, served over stdin/stdout so the Python
 * harness's stub server reads a ledger line exactly as the status route
 * does, instead of keeping a second copy of the rules.
 *
 *   echo '"drive 403 storageQuotaExceeded: …"' | node tests/e2e/backup_classify.mjs
 *   → "storage"
 *
 * One JSON string per input line, one JSON value per output line.
 */
import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";

const root = new URL("../../", import.meta.url).pathname;
// pnpm keeps vite beside vitest, not at the top of node_modules
const requireFromVitest = createRequire(
  realpathSync(`${root}node_modules/vitest/package.json`),
);
const { createServer } = await import(requireFromVitest.resolve("vite"));
const server = await createServer({
  configFile: `${root}vitest.config.ts`, // carries the "@" alias
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});
const { classifyBackupError } = await server.ssrLoadModule(
  "/src/lib/backup-shared.ts",
);

process.stdout.write("ready\n");
for await (const line of createInterface({ input: process.stdin })) {
  process.stdout.write(`${JSON.stringify(classifyBackupError(JSON.parse(line)))}\n`);
}
await server.close();
