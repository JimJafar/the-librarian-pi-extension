// Native Pi slash commands for The Librarian.
//
// sessions-rethink PR 6 — the eight `lib-session-*` + `lib-toggle-private`
// commands are retired and replaced by four user-facing verbs:
//
//   /handoff         — author a five-section narrative and persist via
//                       `store_handoff` for cross-harness pickup.
//   /takeover        — list candidate handoffs, atomically claim one,
//                       inject the document into the conversation.
//   /learn           — extract durable lessons from the conversation and
//                       feed them to `propose_memory`.
//   /toggle-private  — flip the in-conversation `[librarian:private=on|off]`
//                       marker. Pure in-context — no server flag, no hook,
//                       no persisted state.
//
// Each handler emits a prompt that drives the LLM through the agent-side
// flow. Pi command handlers can't run multi-step pickers directly, so the
// LLM (which has the librarian skill / system context) performs the MCP
// calls itself.

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const HANDOFF_PROMPT =
  "Author a five-section handoff document with these exact headings: " +
  "`## Start & intent`, `## Journey`, `## Current state`, `## What's left`, " +
  "`## Open questions`. Then call `store_handoff` with the document. See the " +
  "librarian skill for the full template.";

const TAKEOVER_PROMPT =
  "Call `list_handoffs` with the current project_key + cwd, present candidates " +
  "to the user, then `claim_handoff` on selection and inject the returned " +
  "document_md as system context. See the librarian skill.";

const LEARN_PROMPT =
  "Extract durable lessons from this conversation and feed user-approved ones " +
  "to `propose_memory`. See the librarian skill for the rejection criteria and " +
  "confirmation contract.";

const TOGGLE_ON =
  "Private mode is ON. `[librarian:private=on]` — do not call `remember` or " +
  "`propose_memory` until told otherwise. Recall is still allowed. /handoff " +
  "and /learn require explicit user confirmation. Remain in this state until " +
  "explicitly toggled off.";

const TOGGLE_OFF =
  "Private mode is OFF. `[librarian:private=off]` — normal operation resumed.";

const TOGGLE_PROMPT =
  "Toggle in-conversation private mode. Inject the inverse of the most recent " +
  `\`[librarian:private=on|off]\` marker. If ON: emit \`${TOGGLE_ON}\`. If ` +
  `OFF or no marker: emit \`${TOGGLE_OFF}\`.`;

export function registerCommands(pi: ExtensionAPI): void {
  pi.registerCommand("handoff", {
    description: "Author and persist a cross-harness handoff document",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      ctx.ui.notify(HANDOFF_PROMPT, "info");
    },
  });

  pi.registerCommand("takeover", {
    description: "Pick up a handoff from another agent / harness",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      ctx.ui.notify(TAKEOVER_PROMPT, "info");
    },
  });

  pi.registerCommand("learn", {
    description: "Extract durable lessons from this conversation into memory proposals",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      ctx.ui.notify(LEARN_PROMPT, "info");
    },
  });

  pi.registerCommand("toggle-private", {
    description: "Toggle in-conversation private mode (no server state, no hook)",
    handler: async (_args, ctx: ExtensionCommandContext) => {
      ctx.ui.notify(TOGGLE_PROMPT, "info");
    },
  });
}
