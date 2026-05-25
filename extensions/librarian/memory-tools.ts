// Memory tools, registered natively in the extension.
//
// Pi's CORE has no MCP support (the `mcp.json` / mcpServers feature lives in
// third-party adapter extensions, not the runtime). So rather than ask every user
// to install an MCP adapter and hand-place a config file, the extension exposes the
// Librarian's memory tools to the model itself via `pi.registerTool`, proxying to
// the same remote MCP client the session layer uses. One `pi install`, zero config.
//
// Schemas are pinned to @librarian/mcp-server's memory tool input schemas, minus
// `agent_id` (the server resolves the caller from the bearer token). Session tools
// are intentionally NOT exposed — the extension owns the session lifecycle.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type, type TSchema } from "typebox";
import type { McpClient } from "./vendor/mcp-client.js";

// A string-enum schema — `{ type: "string", enum: [...] }`, the Google/Gemini-
// compatible shape that @earendil-works/pi-ai's StringEnum produces. We build it
// with typebox's Type.Unsafe instead of importing pi-ai: `typebox` is aliased by
// Pi's extension loader in every distribution (the built-in tools import it), but
// the `@earendil-works/pi-ai` specifier is NOT reliably aliased across Pi versions
// / scopes (it fails to resolve on some installs).
function stringEnum<T extends string>(values: readonly T[]): TSchema {
  return Type.Unsafe<T>({ type: "string", enum: [...values] });
}

// Drop undefined values so optional args aren't sent as JSON nulls.
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// A memory-creation schema (shared by remember + propose_memory). Mirrors
// @librarian/mcp-server's memoryInputSchema, minus the token-resolved agent_id.
const memoryInput = Type.Object({
  title: Type.String({ description: "Short memory title." }),
  body: Type.String({ description: "The memory content." }),
  category: Type.String({
    description: "Memory category, e.g. user, project, reference, preference.",
  }),
  visibility: Type.Optional(stringEnum(["common", "agent_private"] as const)),
  scope: Type.Optional(Type.String()),
  project_key: Type.Optional(Type.String()),
  applies_to: Type.Optional(Type.Array(Type.String())),
  priority: Type.Optional(Type.String()),
  confidence: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
});

/**
 * Register the Librarian memory tools as native Pi tools. Each is a thin proxy:
 * validate args via the schema, forward to the remote MCP `tools/call`, return the
 * server's prose. Errors throw (Pi's convention) so the model sees the failure.
 */
export function registerMemoryTools(pi: ExtensionAPI, client: McpClient): void {
  const proxy = (name: string) => async (
    _toolCallId: string,
    params: Record<string, unknown>,
  ) => {
    const text = await client.callTool(name, compact(params));
    return { content: [{ type: "text" as const, text }], details: {} };
  };

  pi.registerTool({
    name: "recall",
    label: "Recall",
    description:
      "Search durable memory for relevant facts. Call before answering when prior " +
      "context (user identity, preferences, project decisions) might exist.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "What to recall." })),
      categories: Type.Optional(Type.Array(Type.String())),
      project_key: Type.Optional(Type.String()),
      include_private: Type.Optional(Type.Boolean()),
      limit: Type.Optional(Type.Number()),
    }),
    execute: proxy("recall"),
  });

  pi.registerTool({
    name: "remember",
    label: "Remember",
    description:
      "Store a durable fact. Use for stable knowledge worth recalling in future " +
      "sessions; protected categories (identity, relationship) are auto-routed to proposals.",
    parameters: memoryInput,
    execute: proxy("remember"),
  });

  pi.registerTool({
    name: "propose_memory",
    label: "Propose memory",
    description: "Propose a memory for human approval (use for protected/sensitive facts).",
    parameters: memoryInput,
    execute: proxy("propose_memory"),
  });

  pi.registerTool({
    name: "verify_memory",
    label: "Verify memory",
    description:
      "Give feedback on a recalled memory so the store learns: 'useful' boosts it, " +
      "'not_useful' demotes it, 'outdated' archives it. Call after using a recall hit.",
    parameters: Type.Object({
      memory_id: Type.String(),
      result: stringEnum(["useful", "not_useful", "outdated"] as const),
      note: Type.Optional(Type.String()),
    }),
    execute: proxy("verify_memory"),
  });

  pi.registerTool({
    name: "update_memory",
    label: "Update memory",
    description: "Patch fields of an existing memory by id.",
    parameters: Type.Object({
      memory_id: Type.String(),
      patch: Type.Object(
        {
          title: Type.Optional(Type.String()),
          body: Type.Optional(Type.String()),
          category: Type.Optional(Type.String()),
          priority: Type.Optional(Type.String()),
          confidence: Type.Optional(Type.String()),
          tags: Type.Optional(Type.Array(Type.String())),
          visibility: Type.Optional(stringEnum(["common", "agent_private"] as const)),
        },
        { additionalProperties: true, description: "Fields to change." },
      ),
    }),
    execute: proxy("update_memory"),
  });

  pi.registerTool({
    name: "start_context",
    label: "Start context",
    description: "Prime a working context for a task; returns relevant memories to start from.",
    parameters: Type.Object({
      task_summary: Type.Optional(Type.String()),
      project_key: Type.Optional(Type.String()),
    }),
    execute: proxy("start_context"),
  });

  pi.registerTool({
    name: "list_proposals",
    label: "List proposals",
    description: "List memory proposals awaiting human approval.",
    parameters: Type.Object({}),
    execute: proxy("list_proposals"),
  });
}

/** The memory tool names this extension registers (for tests/smoke). */
export const MEMORY_TOOL_NAMES = [
  "recall",
  "remember",
  "propose_memory",
  "verify_memory",
  "update_memory",
  "start_context",
  "list_proposals",
] as const;
