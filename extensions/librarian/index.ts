// The Librarian — Pi coding-agent extension.
//
// sessions-rethink PR 6 — the entire session lifecycle (auto-bootstrap on
// `input`, activity-gated checkpoints on `agent_end`, compaction
// checkpoints on `session_compact`, pause on `session_shutdown`, the
// natural-language privacy detector, the on-disk state file) is retired.
// The extension now exposes:
//
//   - the Librarian memory tools (recall / remember / verify_memory / …)
//     via `registerMemoryTools` — unchanged;
//   - four user-facing slash commands (`/handoff`, `/takeover`, `/learn`,
//     `/toggle-private`) — see `commands.ts`;
//   - per-turn conv-state injection via `before_agent_start` — see
//     `handlers/system-prompt-augment.ts`.
//
// Private mode is now purely in-conversation: an
// `[librarian:private=on|off]` marker the LLM owns. There is no server
// flag, no on-disk state, and no privacy hook here.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readConfig } from "./config.js";
import { registerCommands } from "./commands.js";
import { registerMemoryTools } from "./memory-tools.js";
import { createConvStateClient } from "./conv-state-client.js";
import { registerSystemPromptAugment } from "./handlers/system-prompt-augment.js";
import { createMcpClient } from "./lifecycle/mcp-client.js";

const CONFIG_HINT =
  "The Librarian is not configured. Set LIBRARIAN_MCP_URL and LIBRARIAN_AGENT_TOKEN.";

const COMMAND_VERBS = ["handoff", "takeover", "learn", "toggle-private"] as const;

export default function librarian(pi: ExtensionAPI): void {
  const config = readConfig();

  if (!config) {
    // Dormant: no endpoint/token → no automatic calls. Still register the
    // commands so they explain the missing configuration instead of being
    // "unknown command".
    for (const verb of COMMAND_VERBS) {
      pi.registerCommand(verb, {
        description: `${verb} (Librarian not configured)`,
        handler: async (_args, ctx) => {
          ctx.ui.notify(CONFIG_HINT, "warning");
        },
      });
    }
    return;
  }

  const cfg = config;
  // One shared MCP client for the memory tools.
  const mcp = createMcpClient({
    endpoint: cfg.endpoint,
    token: cfg.token,
    ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
  });

  // Expose the Librarian's memory tools to the model directly (no mcp.json needed).
  registerMemoryTools(pi, mcp);

  // Per-turn conv-state injection via `before_agent_start` — implements
  // §4.9 of the upstream memory-domain-isolation spec. The handler is
  // fail-soft end-to-end. There is no privacy gate post-rethink — the
  // conv-state row's own `off_record` field is surfaced by the renderer
  // for the LLM to act on.
  const convStateClient = createConvStateClient((timeoutMs) =>
    createMcpClient({ endpoint: cfg.endpoint, token: cfg.token, timeoutMs }),
  );
  registerSystemPromptAugment(pi, {
    convStateGet: (convId, timeoutMs) => convStateClient.convStateGet(convId, timeoutMs),
  });

  // The four user-facing slash commands. These are agent operations —
  // each handler emits a prompt that drives the LLM through the flow.
  registerCommands(pi);
}
