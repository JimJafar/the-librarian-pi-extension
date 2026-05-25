---
name: use-the-librarian
description: How to use The Librarian's memory + session tools in Pi — when to recall/remember/verify, how the /lib-session-* commands and off-record mode behave, session/memory states, visibility, and the verify-after-recall loop. Use whenever working with Librarian memory or sessions, or when deciding whether to record or recall.
---

# Using The Librarian in Pi

This package connects The Librarian's **remote** MCP server and ships the
`/lib-session-*` commands plus automatic session lifecycle. Memory and sessions
live on the Librarian server configured by `LIBRARIAN_MCP_URL` +
`LIBRARIAN_AGENT_TOKEN`.

Two surfaces, two owners:

- **Memory tools** (`recall`, `remember`, `verify_memory`, …) reach you through
  Pi's MCP config (`mcp.json`) — call them like any other tool.
- **Session lifecycle** is driven by this extension: the `/lib-session-*`
  commands are deterministic code, and start/checkpoint/pause happen
  automatically (see below). You do not call the session tools by hand.

## What you have access to

Memory tools: `start_context`, `recall`, `remember`, `propose_memory`,
`update_memory`, `verify_memory`, `list_proposals`. (`archive_memory` and
`approve_proposal` are admin-only — they appear only with an admin token.)

## The `/lib-session-*` commands

Native Pi slash commands — one per verb:

- `/lib-session-start [title] [--private]` — start a session. `--private` makes it
  `agent_private` visibility (still recorded, just not shared cross-harness).
- `/lib-session-list [--include-ended]` — show resumable sessions; never
  auto-selects. Default scope is `active + paused`.
- `/lib-session-resume [<number|session_id>]` — fetch the handover and attach. No
  argument runs an inline list-and-select. Numbers are scratch from the last
  list; the canonical key is the `session_id`.
- `/lib-session-checkpoint [summary]` / `/lib-session-pause [summary]` /
  `/lib-session-end [summary]` — explicit lifecycle. `end`'s summary is optional —
  the bare call is the "I'm done" abandonment path.
- `/lib-session-search <query>` — full-text search across session events.
- `/lib-toggle-private` — toggle off-record mode. Going off-record ends the
  attached session with a neutral reason and stops automatic recording until you
  toggle back. Natural-language markers ("off the record", "don't remember this")
  do the same directionally.

Automatic lifecycle (no command needed): the extension starts or resumes a
session on your first prompt, checkpoints on compaction and accumulated activity,
and pauses on Pi shutdown — all suppressed while off-record.

## States

Sessions are always `active`, `paused`, or `ended`. `end` covers archive/delete,
`resume` covers restore, and `list` scoped to the current harness covers status.

Memories are `active`, `proposed`, or `archived`. `active` is the recall pool;
`proposed` awaits human approval (auto-routed for protected categories like
`identity` and `relationship`); `archived` is the soft-deleted bucket. Proposals
are accepted/rejected via the dashboard or `update_memory`; deletion is
`archive_memory`.

## Verify-after-recall

When `recall` returns hits and you use one, call `verify_memory` afterwards with a
verdict so the store learns:

- `useful` — the hit was load-bearing for the answer (boosts recall rank).
- `not_useful` — the hit was a distractor or stale framing (drops recall rank).
- `outdated` — the memory is factually wrong now (archives it).

The verdict is a single MCP call; don't skip it because the recall already gave
you the answer — the whole memory-quality loop depends on these signals.

## Visibility

Sessions default to `common` because cross-agent handover is the point of the
layer. Before you consciously start a `common` session with
`/lib-session-start`, scan the surrounding context for sensitivity signals
(identity claims, secrets, personal context, sensitive debugging). If signals are
present and `--private` was not supplied, **confirm with the user first** — the
automatic lifecycle cannot make this judgement, so it is yours to make.

## Capture mode

Default to `summary`. Never enable raw `log` capture by default — it is reserved
for explicit operator request.

## Boundaries

- Session history is **evidence**, not durable memory. Promote selectively via
  `promote_session_fact` or `/lib-session-end` candidates.
- Use `remember` / `propose_memory` for durable facts. Protected categories
  (identity, relationship) always route to proposals.
- Do not auto-promote anything from session content.

## Cross-harness handover

A Librarian session is a **neutral handover layer** that lets work cross harnesses
(Claude Code, Codex, Hermes, OpenCode, Pi). Resume a session started elsewhere
with `/lib-session-resume <id>`; the handover is rendered for Pi.

Canonical cross-harness contract: the abstract surface is `/lib:session <verb>`
(see
[`docs/slash-commands.md`](https://github.com/JimJafar/the-librarian/blob/main/docs/slash-commands.md));
Pi implements it as per-verb commands.
