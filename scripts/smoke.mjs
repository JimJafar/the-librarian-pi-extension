#!/usr/bin/env node
// Smoke test: load the extension through jiti — the SAME loader Pi uses — with a
// mock ExtensionAPI, and assert it registers the expected commands and event
// handlers. This catches load-time breakage (bad imports, jiti resolution, throws
// in the factory) without needing a live Pi or Librarian.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(here);
const indexPath = path.join(root, "extensions", "librarian", "index.ts");

// jiti ships nested under the Pi SDK; resolve it from the SDK's own location.
// The SDK is ESM-only (no CJS/“.” require condition), so resolve via ESM, then
// build a CJS require anchored there to load jiti.
const piMain = fileURLToPath(import.meta.resolve("@earendil-works/pi-coding-agent"));
const piRequire = createRequire(piMain);
const { createJiti } = piRequire("jiti");
const jiti = createJiti(fileURLToPath(import.meta.url));

function fail(msg) {
  console.error(`smoke: FAIL — ${msg}`);
  process.exit(1);
}

function mockPi() {
  const commands = [];
  const events = [];
  return {
    api: {
      registerCommand(name) {
        commands.push(name);
      },
      on(event) {
        events.push(event);
      },
      registerTool() {},
      registerShortcut() {},
      registerFlag() {},
      getFlag() {},
      registerMessageRenderer() {},
      sendMessage() {},
      sendUserMessage() {},
      appendEntry() {},
      getSessionName() {
        return undefined;
      },
      setSessionName() {},
    },
    commands,
    events,
  };
}

const EXPECTED_COMMANDS = [
  "lib-session-start",
  "lib-session-list",
  "lib-session-resume",
  "lib-session-checkpoint",
  "lib-session-pause",
  "lib-session-end",
  "lib-session-search",
  "lib-toggle-private",
];
const EXPECTED_EVENTS = [
  "tool_call",
  "input",
  "agent_end",
  "session_compact",
  "session_shutdown",
  "session_start",
];

function assertSameSet(label, actual, expected) {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (a.length !== e.length || a.some((v, i) => v !== e[i])) {
    fail(`${label}: expected [${e.join(", ")}] but got [${a.join(", ")}]`);
  }
}

const mod = await jiti.import(indexPath);
const factory = mod.default;
if (typeof factory !== "function") fail("default export is not a factory function");

// 1) Dormant mode (no endpoint/token): commands present, no lifecycle wiring.
{
  const saved = { url: process.env.LIBRARIAN_MCP_URL, tok: process.env.LIBRARIAN_AGENT_TOKEN };
  delete process.env.LIBRARIAN_MCP_URL;
  delete process.env.LIBRARIAN_AGENT_TOKEN;
  const { api, commands, events } = mockPi();
  factory(api);
  assertSameSet("dormant commands", commands, EXPECTED_COMMANDS);
  if (events.length !== 0) fail(`dormant mode should register no events, got [${events.join(", ")}]`);
  if (saved.url !== undefined) process.env.LIBRARIAN_MCP_URL = saved.url;
  if (saved.tok !== undefined) process.env.LIBRARIAN_AGENT_TOKEN = saved.tok;
}

// 2) Configured mode: full command + event wiring.
{
  const saved = { url: process.env.LIBRARIAN_MCP_URL, tok: process.env.LIBRARIAN_AGENT_TOKEN };
  process.env.LIBRARIAN_MCP_URL = "https://librarian.example/mcp";
  process.env.LIBRARIAN_AGENT_TOKEN = "smoke-token";
  const { api, commands, events } = mockPi();
  factory(api);
  assertSameSet("configured commands", commands, EXPECTED_COMMANDS);
  assertSameSet("configured events", events, EXPECTED_EVENTS);
  if (saved.url !== undefined) process.env.LIBRARIAN_MCP_URL = saved.url;
  else delete process.env.LIBRARIAN_MCP_URL;
  if (saved.tok !== undefined) process.env.LIBRARIAN_AGENT_TOKEN = saved.tok;
  else delete process.env.LIBRARIAN_AGENT_TOKEN;
}

console.log("smoke: OK — extension loads under jiti; commands and events register as expected");
