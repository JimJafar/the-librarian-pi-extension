// The Librarian — Pi coding-agent extension.
//
// Wires Pi's lifecycle events to deterministic Librarian session automation and
// registers the native /lib-session-* commands. Memory tools (recall/remember/…)
// reach the model separately via mcp.json; this extension owns the SESSION layer.
//
// Event mapping (cf. @librarian/lifecycle's harness adapters):
//   input            → privacy gate + idempotent auto start/resume   (skips slash commands)
//   agent_start      → reset per-turn activity counters
//   tool_call        → accumulate per-turn tool/file activity
//   agent_end        → gated activity checkpoint
//   session_compact  → checkpoint (high-value boundary)
//   session_shutdown → pause (never end, §5.4)
//   session_start    → refresh the footer status indicator (no session is
//                       created just by opening Pi, §5.1)

import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import { buildStateLocation, inferProjectKey, readConfig } from "./config.js";
import { createSessionClient } from "./session-client.js";
import { createOrchestrator, type Orchestrator } from "./orchestrator.js";
import { derivePiSourceRef } from "./source-ref.js";
import { registerCommands } from "./commands.js";
import { registerMemoryTools } from "./memory-tools.js";
import { createConvStateClient } from "./conv-state-client.js";
import { registerSystemPromptAugment } from "./handlers/system-prompt-augment.js";
import { createMcpClient } from "./vendor/mcp-client.js";

const STATUS_KEY = "librarian";
const FILE_MUTATING_TOOLS = new Set(["edit", "write", "multiedit", "apply_patch"]);
const CONFIG_HINT =
  "The Librarian is not configured. Set LIBRARIAN_MCP_URL and LIBRARIAN_AGENT_TOKEN.";

const COMMAND_VERBS = [
  "lib-session-start",
  "lib-session-list",
  "lib-session-resume",
  "lib-session-checkpoint",
  "lib-session-pause",
  "lib-session-end",
  "lib-session-search",
  "lib-toggle-private",
] as const;

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

  // Bind a non-null alias so nested closures keep the narrowing.
  const cfg = config;
  // One MCP client, shared by the session layer and the memory tools.
  const mcp = createMcpClient({
    endpoint: cfg.endpoint,
    token: cfg.token,
    ...(cfg.timeoutMs !== undefined ? { timeoutMs: cfg.timeoutMs } : {}),
  });
  const client = createSessionClient({ endpoint: cfg.endpoint, token: cfg.token }, mcp);

  // Expose the Librarian's memory tools to the model directly (no mcp.json needed).
  registerMemoryTools(pi, mcp);

  // Conv-state injection on every `before_agent_start` — implements §4.9
  // of the upstream memory-domain-isolation spec. The handler is fail-soft
  // end-to-end; an undefined orchestrator (before any input has fired) is
  // treated as private so the Librarian is never called before the on-disk
  // state has been consulted.
  const convStateClient = createConvStateClient((timeoutMs) =>
    createMcpClient({ endpoint: cfg.endpoint, token: cfg.token, timeoutMs }),
  );
  registerSystemPromptAugment(pi, {
    convStateGet: (convId, timeoutMs) => convStateClient.convStateGet(convId, timeoutMs),
    isPrivate: () => orchestrator === undefined || orchestrator.status().privacy === "private",
  });

  // The orchestrator is bound to a cwd; build it lazily from the first event's
  // ctx.cwd (authoritative) and memoize for the process lifetime.
  let orchestrator: Orchestrator | undefined;
  function getOrchestrator(cwd: string): Orchestrator {
    if (orchestrator) return orchestrator;
    // Env override wins; otherwise infer from the repo/folder so users don't need
    // to set LIBRARIAN_PROJECT for the common case.
    const projectKey = cfg.projectKey ?? inferProjectKey(cwd);
    const sourceRef = derivePiSourceRef({
      cwd,
      piSessionId: pi.getSessionName(),
      deviceId: cfg.deviceId,
    });
    orchestrator = createOrchestrator({
      client,
      location: buildStateLocation(cwd, projectKey),
      sourceRef,
      captureMode: cfg.captureMode,
      projectKey,
      ...(cfg.stateBaseDir ? { stateOptions: { baseDir: cfg.stateBaseDir } } : {}),
    });
    return orchestrator;
  }

  function refreshStatus(ctx: ExtensionContext | ExtensionCommandContext): void {
    if (!orchestrator) return;
    const { sessionId, privacy } = orchestrator.status();
    const label =
      privacy === "private"
        ? "librarian: off-record"
        : sessionId
          ? "librarian: on"
          : undefined;
    ctx.ui.setStatus(STATUS_KEY, label);
  }

  // --- Activity accounting since the last checkpoint ----------------------
  // The checkpoint gate expects deltas *since the last checkpoint* (§5.3), so we
  // accumulate across turns and reset only when a checkpoint actually fires.
  let toolCalls = 0;
  let filesTouched = 0;
  function resetActivity(): void {
    toolCalls = 0;
    filesTouched = 0;
  }

  pi.on("tool_call", (event) => {
    toolCalls += 1;
    if (FILE_MUTATING_TOOLS.has(event.toolName)) filesTouched += 1;
  });

  // --- Auto start/resume + privacy gate -----------------------------------
  pi.on("input", async (event, ctx) => {
    // Our own injected messages never drive the lifecycle (avoids loops).
    if (event.source === "extension") return { action: "continue" } as const;
    const text = event.text.trim();
    // Slash commands are handled by the command system, not the auto-lifecycle.
    if (text.startsWith("/") || text.length === 0) return { action: "continue" } as const;
    await getOrchestrator(ctx.cwd).handlePrompt(event.text);
    refreshStatus(ctx);
    return { action: "continue" } as const;
  });

  // --- Checkpoints --------------------------------------------------------
  pi.on("agent_end", async (_event, ctx) => {
    const outcome = await getOrchestrator(ctx.cwd).handleCheckpoint({
      trigger: "activity",
      toolCalls,
      filesTouched,
    });
    if (outcome.action === "checkpointed") resetActivity();
  });

  pi.on("session_compact", async (_event, ctx) => {
    const outcome = await getOrchestrator(ctx.cwd).handleCheckpoint({ trigger: "compaction" });
    if (outcome.action === "checkpointed") resetActivity();
  });

  // --- Pause on shutdown (never end) --------------------------------------
  pi.on("session_shutdown", async (_event, ctx) => {
    await getOrchestrator(ctx.cwd).handlePause();
  });

  // --- Status indicator ---------------------------------------------------
  pi.on("session_start", (_event, ctx) => {
    // Constructing the orchestrator is cheap (no network); it lets the footer
    // reflect any existing on-disk state for this cwd immediately.
    getOrchestrator(ctx.cwd);
    refreshStatus(ctx);
  });

  registerCommands(pi, getOrchestrator, { refreshStatus });
}
