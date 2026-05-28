import { describe, expect, it } from "vitest";
import { createConvStateClient } from "../extensions/librarian/conv-state-client.js";
import { type McpClient, McpClientError } from "../extensions/librarian/lifecycle/mcp-client.js";

function fakeMcp(impl: (name: string, args: Record<string, unknown>) => Promise<string>): McpClient {
  return { callTool: impl };
}

describe("convStateGet", () => {
  it("returns the parsed row when conv_state_get responds with JSON", async () => {
    const client = createConvStateClient(() =>
      fakeMcp(async (name, args) => {
        expect(name).toBe("conv_state_get");
        expect(args).toEqual({ conv_id: "pi:abc" });
        return JSON.stringify({
          conv_id: "pi:abc",
          domain: "work",
          session_id: "ses_1",
          off_record: false,
        });
      }),
    );
    const state = await client.convStateGet("pi:abc", 500);
    expect(state).toEqual({
      conv_id: "pi:abc",
      domain: "work",
      session_id: "ses_1",
      off_record: false,
    });
  });

  it("returns null when conv_state_get responds with the not-found prose", async () => {
    const client = createConvStateClient(() =>
      fakeMcp(async () => "No conversation state for conv_id pi:abc"),
    );
    expect(await client.convStateGet("pi:abc", 500)).toBeNull();
  });

  it("returns null when the response is not parseable JSON", async () => {
    const client = createConvStateClient(() => fakeMcp(async () => "not json {"));
    expect(await client.convStateGet("pi:abc", 500)).toBeNull();
  });

  it("returns null when the response is JSON but missing conv_id", async () => {
    const client = createConvStateClient(() =>
      fakeMcp(async () => JSON.stringify({ domain: "work" })),
    );
    expect(await client.convStateGet("pi:abc", 500)).toBeNull();
  });

  it("returns null on McpClientError (network / http / timeout / rpc)", async () => {
    for (const kind of ["network", "http", "timeout", "rpc", "malformed"] as const) {
      const client = createConvStateClient(() =>
        fakeMcp(async () => {
          throw new McpClientError(kind, "boom");
        }),
      );
      expect(await client.convStateGet("pi:abc", 500)).toBeNull();
    }
  });

  it("returns null on an unexpected throw inside callTool", async () => {
    const client = createConvStateClient(() =>
      fakeMcp(async () => {
        throw new Error("surprise");
      }),
    );
    expect(await client.convStateGet("pi:abc", 500)).toBeNull();
  });

  it("passes the requested timeoutMs to the McpClient factory", async () => {
    const timeouts: number[] = [];
    const client = createConvStateClient((timeoutMs) => {
      timeouts.push(timeoutMs);
      return fakeMcp(async () => "No conversation state for x");
    });
    await client.convStateGet("pi:abc", 500);
    await client.convStateGet("pi:abc", 1000);
    expect(timeouts).toEqual([500, 1000]);
  });
});
