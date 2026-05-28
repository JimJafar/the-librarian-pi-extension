# Changelog

All notable changes to **the-librarian-pi-extension** are documented in
this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This changelog starts at v0.1.3 — the first version likely to see public
adoption. The pre-v0.1.3 development history lives in the git log; only
changes from this point forward are catalogued here.

## [Unreleased]

## [0.2.0] — 2026-05-28

### Added

- **Release runbook + per-repo release doc.** A new
  [`docs/release.md`](docs/release.md) captures the per-repo release
  steps (`package.json` bump, CHANGELOG move, tag, GitHub release).
  AGENTS.md is thinned and points at it; the cross-family runbook
  lives in the monorepo at
  [`the-librarian/docs/release-runbook.md`](https://github.com/JimJafar/the-librarian/blob/main/docs/release-runbook.md).

### Changed

- **Sessions rethink — breaking change (sessions-rethink PR 6).** The
  entire session lifecycle is retired. The Pi extension becomes a
  memory + handoffs surface (no on-disk state, no auto-bootstrap, no
  privacy gate, no per-turn capture).
  - **Removed slash commands**: `/lib-session-start`,
    `/lib-session-list`, `/lib-session-resume`,
    `/lib-session-checkpoint`, `/lib-session-pause`,
    `/lib-session-end`, `/lib-session-search`, `/lib-toggle-private`.
  - **Added slash commands**: `/handoff`, `/takeover`, `/learn`,
    `/toggle-private`. Each surfaces a prompt that drives the LLM
    through the agent-side flow.
  - **Removed events**: `pi.on("input")` auto-bootstrap, `pi.on("tool_call")`
    activity accounting, `pi.on("agent_end")` checkpoint gate,
    `pi.on("session_compact")` checkpoint, `pi.on("session_shutdown")`
    pause, `pi.on("session_start")` status refresh. Only the
    `before_agent_start` conv-state injection survives.
  - **Removed source**: `session-client.ts`, `orchestrator.ts` (602
    lines), `lifecycle/privacy.ts`, `lifecycle/state.ts`,
    `source-ref.ts`. Their tests too.
  - **Slim config**: dropped `CaptureMode`, `buildStateLocation`,
    `inferProjectKey` from `config.ts`. The state-keyed location and
    capture-mode toggle were session-only.
  - **Server compatibility**: requires a Librarian server running the
    sessions-rethink PR 1 build (the `store_handoff` / `list_handoffs`
    / `claim_handoff` and `conv_state_*` MCP tools must exist).
  - **Migration**: existing operators should restart Pi after updating
    the extension. The local `~/.librarian/harness-state/pi/...`
    files the old extension maintained become inert — safe to delete
    by hand.

- **Lifecycle primitives moved from `extensions/librarian/vendor/` to
  `extensions/librarian/lifecycle/`.** The directory rename signals
  the architectural shift: the three modules (`mcp-client.ts`,
  `privacy.ts`, `state.ts`) are no longer synced from the main repo's
  `@librarian/lifecycle` workspace package (which was deleted in
  PR #153 of the main repo when the lifecycle family went fully
  standalone). They are now in-tree source, owned by this repo, and
  kept in lockstep with `the-librarian-claude-plugin/src/*.mts` (the
  only other consumer) per the five-peer-implementations rule.

  Removed in the same change: `scripts/vendor-sync.mjs`,
  `scripts/validate.mjs`, `extensions/librarian/vendor/PROVENANCE.json`,
  the `vendor:sync` and `validate` npm scripts, and the `npm run
  validate` step in CI.

- **AGENTS.md §2** path reference updated to the new location
  (`extensions/librarian/lifecycle/privacy.ts`).

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
  deleted when the family went fully standalone. The in-tree copy
  at `extensions/librarian/lifecycle/privacy.ts` is now one of five
  peer implementations across the family (Claude Code, Codex, Hermes,
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
