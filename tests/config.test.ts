import { describe, expect, it } from "vitest";
import { buildStateLocation, readConfig } from "../extensions/librarian/config.js";

describe("readConfig", () => {
  it("is dormant without endpoint + token", () => {
    expect(readConfig({})).toBeNull();
    expect(readConfig({ LIBRARIAN_MCP_URL: "https://x" })).toBeNull();
    expect(readConfig({ LIBRARIAN_AGENT_TOKEN: "t" })).toBeNull();
  });

  it("reads a configured environment", () => {
    const cfg = readConfig({
      LIBRARIAN_MCP_URL: "https://librarian.example/mcp",
      LIBRARIAN_AGENT_TOKEN: "tok",
      LIBRARIAN_PROJECT: "the-librarian",
      LIBRARIAN_TIMEOUT_MS: "9000",
      PI_DEVICE_ID: "dev-1",
    });
    expect(cfg).toMatchObject({
      endpoint: "https://librarian.example/mcp",
      token: "tok",
      projectKey: "the-librarian",
      timeoutMs: 9000,
      deviceId: "dev-1",
      captureMode: "summary",
    });
  });

  it("defaults capture mode to summary and never auto-selects log without opt-in", () => {
    const base = { LIBRARIAN_MCP_URL: "https://x", LIBRARIAN_AGENT_TOKEN: "t" };
    expect(readConfig(base)?.captureMode).toBe("summary");
    expect(readConfig({ ...base, LIBRARIAN_CAPTURE_MODE: "off" })?.captureMode).toBe("off");
    expect(readConfig({ ...base, LIBRARIAN_CAPTURE_MODE: "log" })?.captureMode).toBe("log");
    expect(readConfig({ ...base, LIBRARIAN_CAPTURE_MODE: "bogus" })?.captureMode).toBe("summary");
  });

  it("ignores a non-positive timeout", () => {
    const cfg = readConfig({
      LIBRARIAN_MCP_URL: "https://x",
      LIBRARIAN_AGENT_TOKEN: "t",
      LIBRARIAN_TIMEOUT_MS: "-5",
    });
    expect(cfg?.timeoutMs).toBeUndefined();
  });
});

describe("buildStateLocation", () => {
  it("keys by cwd and omits source_ref", () => {
    const loc = buildStateLocation("/work/proj", "proj");
    expect(loc).toEqual({
      harness: "pi",
      harnessSessionKey: "/work/proj",
      cwd: "/work/proj",
      projectKey: "proj",
    });
    expect("sourceRef" in loc).toBe(false);
  });

  it("omits projectKey when absent", () => {
    const loc = buildStateLocation("/work/proj");
    expect(loc.projectKey).toBeUndefined();
  });
});
