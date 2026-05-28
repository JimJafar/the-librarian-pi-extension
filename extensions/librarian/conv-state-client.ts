// Conv-state lookup helper for the §4.9 system-prompt injection.
//
// Wraps `./lifecycle/mcp-client` with the fail-soft semantics the spec
// requires: every error path (network, timeout, parse, malformed row)
// collapses to `null` so the caller — the `before_agent_start` hook —
// can always treat the result as "inject the block or don't" without
// branching on error type.

import type { McpClient, McpClientConfig } from "./lifecycle/mcp-client.js";

export interface ConvStateRow {
  conv_id: string;
  // `domain` is required on the wire — the SQLite column is `TEXT NOT
  // NULL DEFAULT 'general'` and the upstream zod schema enforces
  // `z.string().min(1)`. The type was relaxed to optional here for
  // legacy reasons; tightening it forces compile-time errors on any
  // future caller that tries to pass a partial row. The renderer
  // still defends with a `?? "unknown"` fallback in case a malformed
  // row slips through at runtime.
  domain: string;
  session_id?: string | null;
  off_record?: boolean;
}

export interface ConvStateClient {
  /** Resolve the calling conversation's `conv_state` row, or null on any failure. */
  convStateGet(convId: string, timeoutMs: number): Promise<ConvStateRow | null>;
}

/**
 * Builds an `McpClient` for a single conv-state-get call. Injectable so
 * tests pass a fake without touching the HTTP transport.
 */
export type McpFactory = (timeoutMs: number) => McpClient;

/**
 * Convenience factory bound to a static endpoint + token; each
 * `convStateGet` call builds a fresh `McpClient` with the requested
 * per-call timeout (the underlying client only accepts timeouts at
 * construction time).
 */
export function createConvStateClientFromConfig(
  config: Pick<McpClientConfig, "endpoint" | "token">,
  build: (cfg: McpClientConfig) => McpClient,
): ConvStateClient {
  return createConvStateClient((timeoutMs) =>
    build({ endpoint: config.endpoint, token: config.token, timeoutMs }),
  );
}

export function createConvStateClient(mcpFactory: McpFactory): ConvStateClient {
  return {
    async convStateGet(convId, timeoutMs) {
      try {
        const client = mcpFactory(timeoutMs);
        const text = await client.callTool("conv_state_get", { conv_id: convId });
        // `conv_state_get` returns either "No conversation state for conv_id …"
        // or a JSON-stringified state row — only the JSON case becomes a hit.
        if (text.startsWith("No conversation state")) return null;
        return parseRow(text);
      } catch {
        // Every failure → null. The handler treats this exactly the same
        // as a "no row" miss; no error escapes to the user's turn.
        return null;
      }
    },
  };
}

function parseRow(text: string): ConvStateRow | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const candidate = parsed as { conv_id?: unknown };
  if (typeof candidate.conv_id !== "string") return null;
  return parsed as ConvStateRow;
}
