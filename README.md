# the-librarian-pi-extension

[![CI](https://github.com/JimJafar/the-librarian-pi-extension/actions/workflows/ci.yml/badge.svg)](https://github.com/JimJafar/the-librarian-pi-extension/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

A [Pi coding-agent](https://pi.dev) extension for
[The Librarian](https://github.com/JimJafar/the-librarian) — durable memory and
cross-harness narrative handoffs, backed by a Librarian HTTP MCP server you
point at (local or remote).

## Features

- **Memory tools** — `recall` / `remember` / `verify_memory`, … registered as
  native Pi tools (no `mcp.json`, no separate adapter).
- **Four slash commands** — `/handoff`, `/takeover`, `/learn`,
  `/toggle-private`. Each surfaces a prompt that drives the LLM through the
  agent-side flow.
- **Per-turn conv-state injection** via `before_agent_start` — keeps the model
  aware of which domain its memory writes route to, surviving compaction.
- **Fully async** — runs in-process in Pi's long-lived TUI; the event loop is
  never blocked on network I/O.
- **Fail-soft** — Librarian unreachable → memory tools degrade to empty,
  conv-state injection silently skips; the user's turn is never blocked.

## Install

Requires a reachable Librarian MCP server.

```sh
export LIBRARIAN_MCP_URL="https://your-librarian/mcp"
export LIBRARIAN_AGENT_TOKEN="<your agent token>"
```

Then install the package:

```sh
# From GitHub
pi install git:github.com/JimJafar/the-librarian-pi-extension

# Or from a local clone
pi install /path/to/the-librarian-pi-extension
```

That's it — memory tools and the session lifecycle are live. Without
`LIBRARIAN_MCP_URL` + `LIBRARIAN_AGENT_TOKEN` the extension is **dormant**: the
commands report the missing configuration and no automatic calls are made.

## Configure

| Variable | Purpose |
| --- | --- |
| `LIBRARIAN_MCP_URL` | Librarian HTTP MCP URL (required) |
| `LIBRARIAN_AGENT_TOKEN` | Per-agent bearer token (required) |
| `LIBRARIAN_PROJECT` / `LIBRARIAN_PROJECT_KEY` | Override the project key (defaults to git repo name / folder name) |
| `LIBRARIAN_CAPTURE_MODE` | `summary` (default) or `off` — `log` is never auto-selected |
| `LIBRARIAN_TIMEOUT_MS` | Per-call network timeout |
| `PI_DEVICE_ID` | Optional device id used in `source_ref` |

### Remote Librarian

The Librarian's no-auth mode is **localhost-only**, so a remote endpoint **must**
carry a token over **HTTPS**. On the Librarian host:

```sh
LIBRARIAN_HOST=0.0.0.0 LIBRARIAN_AGENT_TOKENS="pi:<strong-token>" pnpm run serve
```

## Commands

- `/lib-session-start [title] [--private]`
- `/lib-session-list [--include-ended]`
- `/lib-session-resume [<number|session_id>]`
- `/lib-session-checkpoint [summary]`
- `/lib-session-pause [summary]`
- `/lib-session-end [summary]`
- `/lib-session-search <query>`
- `/lib-toggle-private`

See the bundled [`use-the-librarian`](./skills/use-the-librarian/SKILL.md) skill
for the full memory + session discipline (states, visibility,
verify-after-recall).

## How it works

| Pi event | Effect |
| --- | --- |
| `input` (non-command prompts) | Privacy gate + idempotent auto start/resume |
| `agent_end` | Activity checkpoint (rate-limited) |
| `session_compact` | Checkpoint (high-value boundary) |
| `session_shutdown` | Pause (never auto-end) |

## License

Apache-2.0.
