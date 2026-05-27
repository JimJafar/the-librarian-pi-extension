# Changelog

All notable changes to **the-librarian-pi-extension** are documented in
this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog starts at v0.1.3 — the first version likely to see public
adoption. The pre-v0.1.3 development history lives in the git log; only
changes from this point forward are catalogued here.

## [Unreleased]

### Added

- **Conv-state injection on every `before_agent_start`.** Implements
  §4.9 of the upstream memory-domain-isolation rollout. A new handler
  fires once per turn (after Pi has assembled the system prompt and
  before the agent loop starts), resolves the calling
  `conversation_state` row via `conv_state_get`, and appends the
  canonical `<conversation-state>` block to `event.systemPrompt`. The
  LLM sees the current `domain` / `session_id` / `off_record` on every
  turn, defeating context-compaction-driven state loss. When no row
  exists, the Librarian is unreachable, or the session is off-record,
  the handler returns no value and Pi's system prompt is unchanged
  (fail-soft per AGENTS.md §2). Co-operates with the SDK's chained-
  extension contract so multiple plugins can augment the system prompt
  without stomping each other.
- `AGENTS.md` with the family-wide house rules (privacy, fail-soft,
  cross-repo contracts, CHANGELOG discipline, etc.) and the
  Pi-extension-specific build / test / gotcha notes. Sibling
  AGENTS.md files in the four other Librarian repos share the same
  baseline.

### Changed

- **AGENTS.md §2** updated: the canonical TS privacy-detector source
  in `the-librarian/integrations/shared/librarian-lifecycle/` was
  deleted when the family went fully standalone. The vendored copy
  at `extensions/librarian/vendor/privacy.ts` is now one of five peer
  implementations across the family (Claude Code, Codex, Hermes,
  OpenCode, this repo). Coordinate any marker-list change across
  all five repos.

## [0.1.3] — 2026-05-26

Public baseline. A [Pi coding-agent](https://pi.dev) package that gives Pi
durable memory and cross-harness session continuity, backed by a remote
[Librarian](https://github.com/JimJafar/the-librarian) MCP server.

### Shipped in this baseline

- **Native Pi memory tools** — `recall`, `remember`, `verify_memory`, etc.
  registered as native Pi tools by the extension via `registerTool`. No
  `mcp.json` and no separate MCP adapter required; the extension talks to
  the remote Librarian itself.
- **`/lib-session-*` Pi commands** — real Pi commands (deterministic, no
  LLM round-trip): `start`, `list`, `resume`, `checkpoint`, `pause`,
  `end`, `search` plus `/lib-toggle-private`. Same cross-harness contract
  as the Claude / Codex / Hermes plugins.
- **Automatic session lifecycle** — a TypeScript extension hooks Pi's
  events to start/checkpoint/pause sessions and gate privacy **before the
  agent runs**.
- **Async-by-design** — Pi runs as a long-lived TUI, so the Librarian
  calls here are fully async; the event loop is never blocked on network
  I/O. Privacy is enforced at the `input` event before the model sees the
  prompt.
- **One-command install** — `pi install`; no manual config files to
  hand-place.

[Unreleased]: https://github.com/JimJafar/the-librarian-pi-extension/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/JimJafar/the-librarian-pi-extension/releases/tag/v0.1.3
