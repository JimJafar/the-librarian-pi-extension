import { describe, expect, it } from "vitest";
import type { McpClient } from "../extensions/librarian/vendor/mcp-client.js";
import { NoSessionError, createSessionClient } from "../extensions/librarian/session-client.js";

interface Call {
  name: string;
  args: Record<string, unknown>;
}

function fakeClient(responder: (name: string, args: Record<string, unknown>) => string): {
  client: McpClient;
  calls: Call[];
} {
  const calls: Call[] = [];
  const client: McpClient = {
    async callTool(name, args) {
      calls.push({ name, args });
      return responder(name, args);
    },
  };
  return { client, calls };
}

const cfg = { endpoint: "https://x/mcp", token: "t" };

describe("session-client arg mapping", () => {
  it("start_session maps args and parses the session", async () => {
    const { client, calls } = fakeClient(
      () => "Session started.\nID: ses_1\nStatus: active\nTitle: Foo\nProject: proj",
    );
    const sc = createSessionClient(cfg, client);
    const session = await sc.start({
      harness: "pi",
      sourceRef: "cwd:/w",
      cwd: "/w",
      projectKey: "proj",
      summary: "hi",
      title: "Foo",
      captureMode: "summary",
    });
    expect(session.id).toBe("ses_1");
    expect(session.status).toBe("active");
    expect(calls[0]).toEqual({
      name: "start_session",
      args: {
        harness: "pi",
        source_ref: "cwd:/w",
        cwd: "/w",
        project_key: "proj",
        start_summary: "hi",
        title: "Foo",
        capture_mode: "summary",
      },
    });
  });

  it("omits undefined args (no JSON nulls)", async () => {
    const { client, calls } = fakeClient(() => "ID: ses_1\nStatus: active");
    const sc = createSessionClient(cfg, client);
    await sc.start({ harness: "pi" });
    expect(calls[0]!.args).toEqual({ harness: "pi" });
    expect("visibility" in calls[0]!.args).toBe(false);
  });

  it("continue_session attaches with the pi format", async () => {
    const { client, calls } = fakeClient(() => "Handover for ses_9 …");
    const sc = createSessionClient(cfg, client);
    const handover = await sc.continue("ses_9", { targetHarness: "pi", targetCwd: "/w" });
    expect(handover).toContain("Handover");
    expect(calls[0]).toEqual({
      name: "continue_session",
      args: { session_id: "ses_9", target_harness: "pi", target_cwd: "/w", attach: true, format: "pi" },
    });
  });

  it("checkpoint and pause always send a summary", async () => {
    const { client, calls } = fakeClient(() => "ok");
    const sc = createSessionClient(cfg, client);
    await sc.checkpoint("ses_1", "cp");
    await sc.pause("ses_1", "pp");
    expect(calls[0]).toEqual({ name: "checkpoint_session", args: { session_id: "ses_1", summary: "cp" } });
    expect(calls[1]).toEqual({ name: "pause_session", args: { session_id: "ses_1", summary: "pp" } });
  });

  it("end omits summary when not given (abandonment path)", async () => {
    const { client, calls } = fakeClient(() => "ended");
    const sc = createSessionClient(cfg, client);
    await sc.end("ses_1");
    expect(calls[0]).toEqual({ name: "end_session", args: { session_id: "ses_1" } });
  });

  it("raises NoSessionError on a not-found prose response", async () => {
    const { client } = fakeClient(() => "No session found for id ses_x.");
    const sc = createSessionClient(cfg, client);
    await expect(sc.checkpoint("ses_x", "cp")).rejects.toBeInstanceOf(NoSessionError);
  });

  it("parses a session list", async () => {
    const list =
      "Sessions:\n1. [active] Build pi ext — the-librarian — pi — last: now\n   id: ses_a\n" +
      "2. [paused] Old work — proj — pi — last: then\n   id: ses_b";
    const { client } = fakeClient(() => list);
    const sc = createSessionClient(cfg, client);
    const sessions = await sc.list({ harness: "pi" });
    expect(sessions.map((s) => s.id)).toEqual(["ses_a", "ses_b"]);
    expect(sessions[0]!.status).toBe("active");
  });
});
