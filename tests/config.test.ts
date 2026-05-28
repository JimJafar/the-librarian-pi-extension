import { describe, expect, it } from "vitest";
import { readConfig } from "../extensions/librarian/config.js";

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
    });
  });

  it("ignores a non-positive timeout", () => {
    const cfg = readConfig({
      LIBRARIAN_MCP_URL: "https://x",
      LIBRARIAN_AGENT_TOKEN: "t",
      LIBRARIAN_TIMEOUT_MS: "-5",
    });
    expect(cfg?.timeoutMs).toBeUndefined();
  });

  it("prefers LIBRARIAN_PROJECT_KEY over LIBRARIAN_PROJECT", () => {
    const cfg = readConfig({
      LIBRARIAN_MCP_URL: "https://x",
      LIBRARIAN_AGENT_TOKEN: "t",
      LIBRARIAN_PROJECT_KEY: "new-key",
      LIBRARIAN_PROJECT: "old-key",
    });
    expect(cfg?.projectKey).toBe("new-key");
  });
});
