# Agent configuration

AI coding agents (Claude Code and Cursor) build this project under the owner's
direction. This folder holds the instructions and tools they share. The
project-wide rules are in [`CLAUDE.md`](../CLAUDE.md) and
[`AGENTS.md`](../AGENTS.md) at the repository root.

| Path | What it holds |
| --- | --- |
| `skills/` | Playbooks that agents load for a task. For example, `snippets-craft` holds the design rules, `verify-snippets` drives the app the way a reader does, and `harden` turns repeated agent mistakes into build-failing checks. |
| `agents/` | Subagent definitions for code review and for effort levels. |
| `vendor/` | A third-party skill pack (pstack, MIT license), kept as its upstream publishes it. |
| `settings.json` | The session-start hooks and which commands agents may run without asking. |
