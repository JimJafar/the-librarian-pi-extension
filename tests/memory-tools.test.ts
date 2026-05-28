import { describe, expect, it } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { McpClient } from "../extensions/librarian/lifecycle/mcp-client.js";
import { MEMORY_TOOL_NAMES, registerMemoryTools } from "../extensions/librarian/memory-tools.js";

interface CapturedTool {
  name: string;
  parameters: unknown;
  execute: (id: string, params: Record<string, unknown>) => Promise<{ content: unknown[] }>;
}

function mockPi(): { pi: ExtensionAPI; tools: CapturedTool[] } {
  const tools: CapturedTool[] = [];
  const pi = {
    registerTool: (t: CapturedTool) => tools.push(t),
  } as unknown as ExtensionAPI;
  return { pi, tools };
}

function fakeClient(
  responder: (name: string, args: Record<string, unknown>) => string,
): { client: McpClient; calls: { name: string; args: Record<string, unknown> }[] } {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client: McpClient = {
    async callTool(name, args) {
      calls.push({ name, args });
      return responder(name, args);
    },
  };
  return { client, calls };
}

describe("registerMemoryTools", () => {
  it("registers exactly the memory tools (no session tools)", () => {
    const { pi, tools } = mockPi();
    const { client } = fakeClient(() => "ok");
    registerMemoryTools(pi, client);
    expect(tools.map((t) => t.name).sort()).toEqual([...MEMORY_TOOL_NAMES].sort());
    expect(tools.some((t) => t.name.endsWith("_session"))).toBe(false);
  });

  it("proxies a call to the MCP client, dropping undefined args", async () => {
    const { pi, tools } = mockPi();
    const { client, calls } = fakeClient(() => "Found 2 memories…");
    registerMemoryTools(pi, client);
    const recall = tools.find((t) => t.name === "recall")!;
    const result = await recall.execute("call-1", { query: "auth", limit: undefined });
    expect(calls[0]).toEqual({ name: "recall", args: { query: "auth" } });
    expect(result.content).toEqual([{ type: "text", text: "Found 2 memories…" }]);
  });

  it("propagates client errors (Pi marks the tool call failed)", async () => {
    const { pi, tools } = mockPi();
    const { client } = fakeClient(() => {
      throw new Error("network down");
    });
    registerMemoryTools(pi, client);
    const remember = tools.find((t) => t.name === "remember")!;
    await expect(
      remember.execute("c", { title: "t", body: "b", category: "project" }),
    ).rejects.toThrow("network down");
  });

  it("every tool exposes a JSON-schema object and none leaks agent_id", () => {
    const { pi, tools } = mockPi();
    const { client } = fakeClient(() => "ok");
    registerMemoryTools(pi, client);
    for (const t of tools) {
      const schema = t.parameters as { type?: string; properties?: Record<string, unknown> };
      expect(schema.type).toBe("object");
      expect(schema.properties && "agent_id" in schema.properties).toBeFalsy();
    }
  });
});
