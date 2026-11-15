# Security

Report a vulnerability through GitHub's private vulnerability reporting.
Open the repository's **Security** tab, and then select **Report a vulnerability**.
Do not open a public issue for a vulnerability.

In the report, include the affected page or API route, the steps to reproduce the problem, and its impact.

[SECURITY-STATE.md](SECURITY-STATE.md) describes what the app does with user data, including its known limits.
`pnpm audit --prod` lists vite and esbuild because better-auth declares vitest and drizzle-kit as optional peer dependencies. Neither ships in the built app.
One person maintains Snippets, and there is no bug bounty.
