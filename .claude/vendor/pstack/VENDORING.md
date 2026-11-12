# pstack, vendored

[Open Pstack](https://github.com/ericlitman/open-pstack) is vendored into
this repo's agent tooling, the same way `src/vendor/paper-shaders`, the
shadcn sources, and `.claude/skills/action-first-replies` are vendored: the files
are ours to edit, and the licenses travel with them. The upstream
authors named below are third parties, unrelated to this repository's
owner.

## Sync point

| Source | Value |
| --- | --- |
| Repository | `https://github.com/ericlitman/open-pstack` |
| Commit | `27e0ce32be3dfc496d1372a4f3d45d91d15007da` |
| Release | Open Pstack 1.2.0 (August 26, 2026) |
| Upstream | Cursor's pstack 0.14.3, by Lauren Tan ([@poteto](https://x.com/poteto)) |

`UPSTREAM.md` and `CHANGES.md` in this directory are Open Pstack's own
records of what it tracks and what it changed. `NOTICE.md` records
provenance. The licenses are MIT: `LICENSE` (Open Pstack),
`LICENSE-superpowers`, and `LICENSE-cursor-team-kit`.

## What landed where

Open Pstack ships as a Claude Code plugin, which namespaces its skills as
`/pstack:poteto-mode`. This repo vendors the plugin's contents as plain
project skills instead, so the entry point is `/poteto-mode`:

- `plugins/pstack/skills/*` copied to `.claude/skills/*` (52 skills; the
  22 `principle-*` leaves carry `user-invocable: false`, so they stay out
  of the slash-command list and remain readable by the model).
- `plugins/pstack/agents/*` copied to `.claude/agents/*` (12 agent
  definitions, including `poteto-agent`, which `/poteto-mode` routes to).
- Licenses, provenance, the technical reference, and the plugin's
  session-start context copied to this directory.

Nothing was renamed, and no skill name collided with a skill this repo
already had.

## What was left out

- **The `SessionStart` hook.** The plugin injects a mandate that routes
  every non-trivial task through poteto-mode automatically. This repo
  runs poteto-mode on request instead. `session-start-context.md` in this
  directory holds the mandate text, rewritten for the unprefixed skill
  names, for anyone who wants to wire it into `.claude/settings.json`.
- **Plugin manifests, CI, and the Codex packaging.** They describe a
  plugin this repo does not install.

## Update the vendored copy

1. Clone `https://github.com/ericlitman/open-pstack` at the tag you want.
2. Diff `plugins/pstack/skills` and `plugins/pstack/agents` against
   `.claude/skills` and `.claude/agents`, and keep any local edits.
3. Update the sync-point table in this file.

## Where the model tooling needs setup

`/setup-pstack` configures pstack's multi-model roles. It expects the
Claude Code, Codex, and Grok command-line tools, plus
[Bun](https://bun.sh) for the launcher under
`.claude/skills/poteto-mode/scripts/`. Without that setup, the workflow
skills still run on the session's own model, and the multi-model panels
in `arena`, `architect`, `interrogate`, and `how` fall back to fewer
providers. `reference.md` lists every skill.
