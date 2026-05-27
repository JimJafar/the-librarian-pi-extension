// Conv-state injection via `before_agent_start` — implements §4.9 for
// the Pi extension (spec: docs/specs/pi-extension-conv-state-injection-spec.md).
//
// The hook fires once per turn after Pi has assembled the system prompt
// but before the agent loop starts. We resolve the calling conv_state
// row from the Librarian, append the canonical `<conversation-state>`
// block to `event.systemPrompt`, and return it — the SDK chains multiple
// extensions' systemPrompt returns, so our append cooperates with any
// other plugin that also augments the system prompt.
//
// Fail-soft contract (AGENTS.md §2): every error path returns undefined
// (no return value) so the SDK leaves the system prompt unchanged. The
// user's turn is never blocked, no stack trace ever surfaces, and a
// Librarian outage is silent except for an optional log entry.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ConvStateRow } from "../conv-state-client.js";
import { renderConvStateBlock } from "../conv-state-render.js";

const CONV_STATE_TIMEOUT_MS = 500;

export interface SystemPromptAugmentDeps {
  convStateGet: (convId: string, timeoutMs: number) => Promise<ConvStateRow | null>;
  /**
   * Returns true when the user has toggled the extension off-record. Sync
   * (matches `orchestrator.status()` — the only caller — which reads
   * in-memory state synchronously). The spec sketch showed an async signature
   * but the implementation is sync because the underlying state read is too.
   */
  isPrivate: () => boolean;
  /** Optional sidecar log. Errors during conv-state fetch are written here. */
  log?: (entry: Record<string, unknown>) => void;
}

export function registerSystemPromptAugment(
  pi: ExtensionAPI,
  deps: SystemPromptAugmentDeps,
): void {
  pi.on("before_agent_start", async (event) => {
    try {
      // Privacy gate: off-record suppresses every Librarian call. Checked
      // BEFORE convStateGet so an off-record session can never observe
      // network activity from this handler.
      if (deps.isPrivate()) return;

      // Conv-id from the Pi session name. Stable per Pi session; same
      // value the existing extension uses for source_ref derivation.
      const sessionName = pi.getSessionName();
      if (!sessionName) return;

      const state = await deps.convStateGet(`pi:${sessionName}`, CONV_STATE_TIMEOUT_MS);
      if (!state) return;

      return {
        systemPrompt: `${event.systemPrompt}\n\n${renderConvStateBlock(state)}`,
      };
    } catch (err) {
      // Defensive net — every inner call already swallows its own errors,
      // but a top-level throw must never break the user's turn.
      deps.log?.({
        event: "before_agent_start",
        outcome: "conv_state_inject_threw",
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
  });
}
