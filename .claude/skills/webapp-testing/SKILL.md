---
name: webapp-testing
description: Toolkit for interacting with and testing local web applications. agent-browser (Vercel) is the default driver; Playwright for Python is the fallback for what agent-browser cannot do. Supports verifying frontend functionality, debugging UI behavior, capturing browser screenshots, and viewing browser logs.
license: Complete terms in LICENSE.txt
---

# Web application testing

**Local modification (2026-09-08):** upstream ships this skill as a
Playwright-only toolkit. This repo drives browsers with
[agent-browser](https://github.com/vercel-labs/agent-browser) by default
and keeps Playwright as the fallback. The `scripts/with_server.py` helper
is unchanged and still manages server lifecycle for both.

For this repo's own app, `verify-snippets` is the skill to use — it owns
the personas, the engines, and the evidence standard. This skill is the
lower-level toolkit it builds on.

## Pick a driver

Use **agent-browser** unless you need something in the fallback list.
It drives Chrome over CDP from the command line, so a proof is a batch of
commands instead of a script file.

Fall back to **Playwright for Python** for:

- **Non-Chromium engines.** agent-browser is Chrome/CDP only. Gecko
  (Firefox) and WebKit stay on their existing lanes.
- **Per-context isolation in one process.** Playwright's `new_context()`
  gives a fresh profile per page; agent-browser isolates by `--session`.
- **Existing harnesses.** The `scripts/measure-*.py` files and
  `tests/e2e/*.py` are Playwright and stay that way; they are frozen
  proofs of past fixes. Do not port them without a reason.

## Run agent-browser

The binary is a pinned devDependency (`agent-browser` in `package.json`),
so `pnpm install` provides it at `node_modules/.bin/agent-browser`.

In this repo, call it through the wrapper, which supplies the sandbox
settings and adds personas:

```sh
.claude/skills/verify-snippets/scripts/ab open http://127.0.0.1:3000/
```

Three sandbox facts the wrapper encodes, measured 2026-09-08:

1. `agent-browser install` **fails here** — the Chrome for Testing CDN is
   blocked by the agent proxy. The wrapper points
   `AGENT_BROWSER_EXECUTABLE_PATH` at the pinned Playwright Chromium at
   `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` instead.
2. Chromium needs `--no-sandbox --disable-dev-shm-usage` running as root.
3. `HTTPS_PROXY` must not swallow localhost, or the app is unreachable.

### Put a whole proof in one batch

`batch` runs commands in order against one page and prints each result:

```sh
ab batch --bail \
  "set viewport 393 852" \
  "open http://127.0.0.1:3000/calendar" \
  "wait 5000" \
  "eval 'document.querySelectorAll(\"[data-day]\").length'" \
  "screenshot /tmp/out/book.png"
```

`--bail` stops at the first error. Without it every command runs and you
read the failures at the end.

Named sessions persist across separate invocations, so an exploratory
sequence also works one command at a time:

```sh
ab --session probe open http://127.0.0.1:3000/calendar
ab --session probe snapshot -i        # interactive elements, with @refs
ab --session probe click @e3
ab --session probe close --all        # always close what you opened
```

The default session is fine for one-offs. `close --all` ends every
session, so use it only when you mean it.

### Quote arguments that contain spaces

**This is the one rule that bites.** `batch` re-splits each command
string on spaces, so an argument containing a space is truncated. Wrap it
in single quotes inside the double-quoted command:

```sh
# WRONG — the eval stops at the first space, giving "Unexpected token ':'"
"eval (JSON.stringify({a: 1}))"

# RIGHT
"eval 'JSON.stringify({a: 1})'"

# WRONG — selector truncated at the space
"click button[aria-label=\"Keep today's entry\"]"

# RIGHT — a space-free selector, or single-quote the whole thing
"click button[aria-label^=\"Keep\"]"
```

An object literal at the start of an `eval` also parses as a block, so
wrap it: `eval 'JSON.stringify({...})'` or `eval '({a: 1})'`.

### Commands worth knowing

| Command | What it gives you |
| --- | --- |
| `snapshot [-i] [-c]` | Accessibility tree with `@ref` handles — the cheapest way to find elements |
| `eval '<js>'` | Runs JS and prints the result; awaits a returned Promise |
| `get text\|html\|value\|attr\|box\|styles <sel>` | Read one thing without writing JS |
| `is visible\|enabled\|checked <sel>` | State assertions |
| `find role\|text\|label\|testid <v> <action>` | Semantic locators |
| `screenshot <path>` / `--annotate` | Image, optionally with numbered labels |
| `console` / `errors` | Console logs and page errors collected during the run |
| `network requests` / `network route <url> --abort` | Inspect or stub network |
| `set viewport <w> <h>` / `set media dark` / `set offline on` | Viewport, theme, offline |
| `storage local\|session` / `cookies` | Storage readouts |
| `vitals --json` | Core Web Vitals |
| `diff screenshot --baseline` | Visual regression against a baseline |

`agent-browser skills get core --full` prints the full, version-matched
command reference. Prefer it over guessing from flags.

## Manage the server

`scripts/with_server.py` starts servers, waits for their ports, runs your
command, and kills what it started. It is driver-agnostic — pass a shell
script that calls `ab`, or a Python script that uses Playwright:

```sh
python3 .claude/skills/webapp-testing/scripts/with_server.py \
  --server "node_modules/.bin/next start" --port 3000 -- bash proof.sh
```

Multiple servers:

```sh
python3 scripts/with_server.py \
  --server "cd backend && python server.py" --port 3000 \
  --server "cd frontend && npm run dev" --port 5173 \
  -- bash proof.sh
```

Run any bundled script with `--help` first. Treat them as black boxes;
reading the source pollutes your context for no gain.

## Playwright fallback

When you need an engine or an isolation model agent-browser lacks:

```python
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto('http://localhost:3000')
    page.wait_for_load_state('networkidle')  # CRITICAL on dynamic apps
    browser.close()
```

This sandbox pins Chromium 1194 at `/opt/pw-browsers`, so install the
matching client: `pip install playwright==1.56.0`. Never run
`playwright install` — downloads are blocked.

## Reconnaissance, then action

Both drivers reward looking before acting:

1. Load the page and wait for it to settle (`wait 5000`, or
   `wait_for_load_state('networkidle')` in Playwright).
2. Inspect: `ab snapshot -i` or a screenshot, not a guess at the markup.
3. Act on the handles you found — `@ref`s, `aria-label`s, `data-*`
   attributes. Never coordinates or tab order.

## Reference files

- `examples/` — Playwright patterns, kept for the fallback lane:
  `element_discovery.py`, `static_html_automation.py`,
  `console_logging.py`.
