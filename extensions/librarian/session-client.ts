// Async Librarian session client for Pi.
//
// Pi extensions run in a long-lived, in-process TUI: handlers are async and must
// NOT block the event loop on synchronous network I/O. So — unlike the hook-based
// harnesses, which bridge sync→async by spawning the `mcp-call` bin per verb — we
// talk to the remote Librarian directly with the (already security-hardened)
// async MCP client and keep everything non-blocking.
//
// Tool argument shapes are pinned to @librarian/mcp-server's tool input schemas
// (start_session / list_sessions / continue_session / checkpoint_session /
// pause_session / end_session / search_sessions). The prose responses are parsed
// by the vendored helpers.

import {
  type McpClient,
  type ParsedSession,
  createMcpClient,
  parseSessionFromProse,
  parseSessionListFromProse,
} from "./vendor/mcp-client.js";

export type { ParsedSession };

export type CaptureMode = "off" | "summary" | "log";
export type Visibility = "common" | "agent_private";

export interface StartArgs {
  harness: string;
  sourceRef?: string | undefined;
  cwd?: string | undefined;
  projectKey?: string | undefined;
  summary?: string | undefined;
  title?: string | undefined;
  visibility?: Visibility | undefined;
  captureMode?: CaptureMode | undefined;
}

export interface ListArgs {
  harness?: string | undefined;
  cwd?: string | undefined;
  projectKey?: string | undefined;
  statuses?: string[] | undefined;
  includeEnded?: boolean | undefined;
  limit?: number | undefined;
}

export interface ContinueArgs {
  targetHarness?: string | undefined;
  targetCwd?: string | undefined;
  targetSourceRef?: string | undefined;
}

export interface SessionClient {
  start(args: StartArgs): Promise<ParsedSession>;
  list(args: ListArgs): Promise<ParsedSession[]>;
  /** Returns the handover text; the session id is the one passed in. */
  continue(sessionId: string, args?: ContinueArgs): Promise<string>;
  checkpoint(sessionId: string, summary: string): Promise<void>;
  pause(sessionId: string, summary: string): Promise<void>;
  end(sessionId: string, summary?: string): Promise<void>;
  /** Returns the formatted (prose) search result for display. */
  search(query: string, limit?: number): Promise<string>;
}

export interface SessionClientConfig {
  endpoint: string;
  token: string;
  timeoutMs?: number | undefined;
}

// Drop undefined values so optional args are never sent as JSON nulls.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

class NoSessionError extends Error {
  override readonly name = "NoSessionError";
}

// The Librarian formatters answer a missing id with "No session found …" rather
// than an RPC error, so surface that as a typed failure the orchestrator can log.
function ensureFound(text: string, verb: string): void {
  if (/^No session found/i.test(text.trim())) {
    throw new NoSessionError(`${verb}: ${text.split("\n", 1)[0] ?? text}`);
  }
}

export function createSessionClient(
  config: SessionClientConfig,
  client?: McpClient,
): SessionClient {
  const mcp =
    client ??
    createMcpClient({
      endpoint: config.endpoint,
      token: config.token,
      ...(config.timeoutMs !== undefined ? { timeoutMs: config.timeoutMs } : {}),
    });

  return {
    async start(args) {
      const text = await mcp.callTool(
        "start_session",
        compact({
          harness: args.harness,
          source_ref: args.sourceRef,
          cwd: args.cwd,
          project_key: args.projectKey,
          start_summary: args.summary,
          title: args.title,
          visibility: args.visibility,
          capture_mode: args.captureMode,
        }),
      );
      const session = parseSessionFromProse(text);
      if (!session) throw new Error(`start_session: ${text.split("\n", 1)[0] ?? text}`);
      return session;
    },

    async list(args) {
      const text = await mcp.callTool(
        "list_sessions",
        compact({
          harness: args.harness,
          cwd: args.cwd,
          project_key: args.projectKey,
          status: args.statuses,
          include_ended: args.includeEnded,
          limit: args.limit,
        }),
      );
      return parseSessionListFromProse(text);
    },

    async continue(sessionId, args = {}) {
      const text = await mcp.callTool(
        "continue_session",
        compact({
          session_id: sessionId,
          target_harness: args.targetHarness,
          target_cwd: args.targetCwd,
          target_source_ref: args.targetSourceRef,
          attach: true,
          format: "pi",
        }),
      );
      ensureFound(text, "continue");
      return text;
    },

    async checkpoint(sessionId, summary) {
      const text = await mcp.callTool(
        "checkpoint_session",
        compact({ session_id: sessionId, summary }),
      );
      ensureFound(text, "checkpoint");
    },

    async pause(sessionId, summary) {
      const text = await mcp.callTool("pause_session", compact({ session_id: sessionId, summary }));
      ensureFound(text, "pause");
    },

    async end(sessionId, summary) {
      const text = await mcp.callTool(
        "end_session",
        compact({ session_id: sessionId, summary }),
      );
      ensureFound(text, "end");
    },

    async search(query, limit) {
      return mcp.callTool("search_sessions", compact({ query, limit }));
    },
  };
}

export { NoSessionError };
