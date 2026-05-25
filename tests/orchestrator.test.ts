import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildStateLocation } from "../extensions/librarian/config.js";
import { createOrchestrator } from "../extensions/librarian/orchestrator.js";
import { McpClientError } from "../extensions/librarian/vendor/mcp-client.js";
import { stateFilePath } from "../extensions/librarian/vendor/state.js";
import type { ParsedSession, SessionClient } from "../extensions/librarian/session-client.js";

class FakeClient implements SessionClient {
  calls: string[] = [];
  listResult: ParsedSession[] = [];
  startId = "ses_new";
  failStart = false;

  private session(id: string): ParsedSession {
    return { id, status: "active", title: null, project_key: null, source_ref: null, cwd: null };
  }
  async start(): Promise<ParsedSession> {
    this.calls.push("start");
    if (this.failStart) throw new McpClientError("network", "boom");
    return this.session(this.startId);
  }
  async list(): Promise<ParsedSession[]> {
    this.calls.push("list");
    return this.listResult;
  }
  async continue(id: string): Promise<string> {
    this.calls.push(`continue:${id}`);
    return "handover";
  }
  async checkpoint(id: string): Promise<void> {
    this.calls.push(`checkpoint:${id}`);
  }
  async pause(id: string): Promise<void> {
    this.calls.push(`pause:${id}`);
  }
  async end(id: string, summary?: string): Promise<void> {
    this.calls.push(`end:${id}:${summary ?? ""}`);
  }
  async search(): Promise<string> {
    this.calls.push("search");
    return "results";
  }
}

let baseDir: string;
const LOCATION = buildStateLocation("/work/proj", "proj");

function makeOrchestrator(client: SessionClient, now?: () => number) {
  return createOrchestrator({
    client,
    location: LOCATION,
    sourceRef: "cwd:/work/proj",
    captureMode: "summary",
    projectKey: "proj",
    stateOptions: { baseDir },
    ...(now ? { now } : {}),
  });
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "lib-pi-"));
});
afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

describe("auto start / resume", () => {
  it("starts a session on the first prompt when none matches", async () => {
    const client = new FakeClient();
    const o = makeOrchestrator(client);
    const outcome = await o.handlePrompt("let's build the thing");
    expect(outcome.action).toBe("started");
    expect(outcome.sessionId).toBe("ses_new");
    expect(client.calls).toContain("list");
    expect(client.calls).toContain("start");
    expect(o.status().sessionId).toBe("ses_new");
  });

  it("is idempotent — a second prompt does not start again", async () => {
    const client = new FakeClient();
    const o = makeOrchestrator(client);
    await o.handlePrompt("first");
    const outcome = await o.handlePrompt("second");
    expect(outcome.action).toBe("active");
    expect(client.calls.filter((c) => c === "start")).toHaveLength(1);
  });

  it("resumes a single matching session instead of starting", async () => {
    const client = new FakeClient();
    client.listResult = [
      { id: "ses_x", status: "paused", title: "old", project_key: "proj", source_ref: null, cwd: null },
    ];
    const o = makeOrchestrator(client);
    const outcome = await o.handlePrompt("pick up where I left off");
    expect(outcome.action).toBe("resumed");
    expect(outcome.sessionId).toBe("ses_x");
    expect(client.calls).toContain("continue:ses_x");
    expect(client.calls).not.toContain("start");
  });

  it("starts fresh when multiple sessions match (never guesses)", async () => {
    const client = new FakeClient();
    client.listResult = [
      { id: "a", status: "active", title: null, project_key: null, source_ref: null, cwd: null },
      { id: "b", status: "paused", title: null, project_key: null, source_ref: null, cwd: null },
    ];
    const o = makeOrchestrator(client);
    const outcome = await o.handlePrompt("hello");
    expect(outcome.action).toBe("started");
  });

  it("reports an error (not a crash) when the start call fails", async () => {
    const client = new FakeClient();
    client.failStart = true;
    const o = makeOrchestrator(client);
    const outcome = await o.handlePrompt("hello");
    expect(outcome.action).toBe("error");
    expect(o.status().sessionId).toBeUndefined();
  });
});

describe("privacy", () => {
  it("enter-private marker ends the attached session and suppresses", async () => {
    const client = new FakeClient();
    const o = makeOrchestrator(client);
    await o.handlePrompt("start work");
    const outcome = await o.handlePrompt("off the record, this is sensitive");
    expect(outcome.action).toBe("entered-private");
    expect(outcome.privacy).toBe("private");
    expect(client.calls).toContain("end:ses_new:switching to private mode");
    expect(o.status().privacy).toBe("private");
  });

  it("makes no Librarian call while off-record", async () => {
    const client = new FakeClient();
    const o = makeOrchestrator(client);
    await o.handlePrompt("off the record");
    client.calls.length = 0;
    const outcome = await o.handlePrompt("do something secret");
    expect(outcome.action).toBe("suppressed-private");
    expect(client.calls).toHaveLength(0);
  });

  it("exit-private flips public without recording the prompt", async () => {
    const client = new FakeClient();
    const o = makeOrchestrator(client);
    await o.handlePrompt("off the record");
    client.calls.length = 0;
    const outcome = await o.handlePrompt("back on the record");
    expect(outcome.action).toBe("exited-private");
    expect(outcome.privacy).toBe("public");
    expect(client.calls).toHaveLength(0);
    // The next ordinary prompt starts fresh.
    const next = await o.handlePrompt("resume normal work");
    expect(next.action).toBe("started");
  });

  it("toggle flips private then back to public", async () => {
    const client = new FakeClient();
    const o = makeOrchestrator(client);
    await o.handlePrompt("start work");
    expect((await o.toggle()).privacy).toBe("private");
    expect((await o.toggle()).privacy).toBe("public");
  });

  it("ignores the toggle command typed as input (the command owns it)", async () => {
    const client = new FakeClient();
    const o = makeOrchestrator(client);
    const outcome = await o.handlePrompt("/lib-toggle-private");
    expect(outcome.action).toBe("ignored");
    expect(client.calls).toHaveLength(0);
  });
});

describe("checkpoint gating", () => {
  async function withSession(): Promise<{ o: ReturnType<typeof makeOrchestrator>; client: FakeClient }> {
    const client = new FakeClient();
    const o = makeOrchestrator(client);
    await o.handlePrompt("start");
    client.calls.length = 0;
    return { o, client };
  }

  it("skips a low-activity checkpoint", async () => {
    const { o, client } = await withSession();
    const outcome = await o.handleCheckpoint({ trigger: "activity", toolCalls: 1, filesTouched: 0 });
    expect(outcome.action).toBe("skipped-gate");
    expect(client.calls).toHaveLength(0);
  });

  it("checkpoints on a compaction boundary", async () => {
    const { o, client } = await withSession();
    const outcome = await o.handleCheckpoint({ trigger: "compaction" });
    expect(outcome.action).toBe("checkpointed");
    expect(client.calls).toContain("checkpoint:ses_new");
  });

  it("checkpoints when accumulated tool calls cross the gate", async () => {
    const { o } = await withSession();
    const outcome = await o.handleCheckpoint({ trigger: "activity", toolCalls: 9, filesTouched: 0 });
    expect(outcome.action).toBe("checkpointed");
  });

  it("reports no-session when nothing is attached", async () => {
    const client = new FakeClient();
    const o = makeOrchestrator(client);
    const outcome = await o.handleCheckpoint({ trigger: "compaction" });
    expect(outcome.action).toBe("no-session");
  });

  it("suppresses checkpoints while off-record", async () => {
    const { o, client } = await withSession();
    await o.toggle(); // go private
    client.calls.length = 0;
    const outcome = await o.handleCheckpoint({ trigger: "compaction" });
    expect(outcome.action).toBe("suppressed-private");
    expect(client.calls).toHaveLength(0);
  });
});

describe("pause", () => {
  it("pauses and detaches so the next prompt resumes by cwd", async () => {
    const client = new FakeClient();
    const o = makeOrchestrator(client);
    await o.handlePrompt("start");
    const action = await o.handlePause();
    expect(action).toBe("paused");
    expect(client.calls).toContain("pause:ses_new");
    expect(o.status().sessionId).toBeUndefined();
  });
});

describe("fail-closed on corrupt state", () => {
  it("suppresses and makes no call when local state is unreadable", async () => {
    const file = stateFilePath(LOCATION, { baseDir });
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "{ this is not json");
    const client = new FakeClient();
    const o = makeOrchestrator(client);
    const outcome = await o.handlePrompt("hello");
    expect(outcome.action).toBe("suppressed-error");
    expect(outcome.privacy).toBe("private");
    expect(client.calls).toHaveLength(0);
  });
});
