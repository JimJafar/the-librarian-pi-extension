import { describe, expect, it, vi } from "vitest";
import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionHandler,
} from "@earendil-works/pi-coding-agent";
import { registerSystemPromptAugment } from "../extensions/librarian/handlers/system-prompt-augment.js";
import type { ConvStateRow } from "../extensions/librarian/conv-state-client.js";

interface CapturedHandler {
  // Only `before_agent_start` is wired here, so the handler type narrows.
  handler: ExtensionHandler<BeforeAgentStartEvent, { systemPrompt?: string } | undefined | void>;
}

function fakePi(sessionName: string | undefined): ExtensionAPI & CapturedHandler {
  const captured: Partial<CapturedHandler> = {};
  const api = {
    on: vi.fn((event: string, handler: unknown) => {
      if (event === "before_agent_start") {
        (captured as Record<string, unknown>).handler = handler;
      }
    }),
    getSessionName: vi.fn(() => sessionName),
  } as unknown as ExtensionAPI;
  // Pi's ExtensionAPI is wide; tests only exercise the two surfaces above.
  return new Proxy(api as ExtensionAPI & CapturedHandler, {
    get(target, prop, receiver) {
      if (prop === "handler") return captured.handler;
      return Reflect.get(target, prop, receiver);
    },
  });
}

function event(systemPrompt = "BASE_SYSTEM"): BeforeAgentStartEvent {
  return {
    type: "before_agent_start",
    prompt: "hello",
    systemPrompt,
    // Tests only assert on the systemPrompt return — the options shape is
    // not load-bearing here.
    systemPromptOptions: {} as BeforeAgentStartEvent["systemPromptOptions"],
  };
}

const STATE: ConvStateRow = {
  conv_id: "pi:abc",
  domain: "work",
  session_id: "ses_1",
  off_record: false,
};

describe("registerSystemPromptAugment", () => {
  it("appends the canonical block to event.systemPrompt on a state hit", async () => {
    const pi = fakePi("abc");
    const convStateGet = vi.fn(async () => STATE);
    registerSystemPromptAugment(pi, { convStateGet, isPrivate: () => false });

    const result = await pi.handler(event("BASE_SYSTEM"), {} as never);

    expect(convStateGet).toHaveBeenCalledWith("pi:abc", 500);
    expect(result).toEqual({
      systemPrompt:
        "BASE_SYSTEM\n\n" +
        [
          "<conversation-state>",
          "  conv_id: pi:abc",
          "  domain: work",
          "  session_id: ses_1",
          "  off_record: false",
          "</conversation-state>",
        ].join("\n"),
    });
  });

  it("returns undefined when convStateGet resolves null (miss)", async () => {
    const pi = fakePi("abc");
    const convStateGet = vi.fn(async () => null);
    registerSystemPromptAugment(pi, { convStateGet, isPrivate: () => false });

    const result = await pi.handler(event(), {} as never);
    expect(result).toBeUndefined();
    expect(convStateGet).toHaveBeenCalledTimes(1);
  });

  it("returns undefined and logs when convStateGet throws", async () => {
    const pi = fakePi("abc");
    const convStateGet = vi.fn(async () => {
      throw new Error("boom");
    });
    const log = vi.fn();
    registerSystemPromptAugment(pi, { convStateGet, isPrivate: () => false, log });

    const result = await pi.handler(event(), {} as never);
    expect(result).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatchObject({
      event: "before_agent_start",
      outcome: "conv_state_inject_threw",
    });
  });

  it("never calls convStateGet when off-record", async () => {
    const pi = fakePi("abc");
    const convStateGet = vi.fn(async () => STATE);
    registerSystemPromptAugment(pi, { convStateGet, isPrivate: () => true });

    const result = await pi.handler(event(), {} as never);
    expect(result).toBeUndefined();
    expect(convStateGet).not.toHaveBeenCalled();
  });

  it("returns undefined when pi.getSessionName() is undefined", async () => {
    const pi = fakePi(undefined);
    const convStateGet = vi.fn(async () => STATE);
    registerSystemPromptAugment(pi, { convStateGet, isPrivate: () => false });

    const result = await pi.handler(event(), {} as never);
    expect(result).toBeUndefined();
    expect(convStateGet).not.toHaveBeenCalled();
  });
});
