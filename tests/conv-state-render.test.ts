import { describe, expect, it } from "vitest";
import type { ConvStateRow } from "../extensions/librarian/conv-state-client.js";
import { renderConvStateBlock } from "../extensions/librarian/conv-state-render.js";

describe("renderConvStateBlock", () => {
  it("renders the canonical §4.9 block exactly", () => {
    const block = renderConvStateBlock({
      conv_id: "pi:abc",
      domain: "work",
      session_id: "ses_1",
      off_record: false,
    });
    expect(block).toBe(
      [
        "<conversation-state>",
        "  conv_id: pi:abc",
        "  domain: work",
        "  session_id: ses_1",
        "  off_record: false",
        "</conversation-state>",
      ].join("\n"),
    );
  });

  it("falls back to session_id: none when the row has no session", () => {
    const block = renderConvStateBlock({
      conv_id: "pi:abc",
      domain: "personal",
      session_id: null,
      off_record: false,
    });
    expect(block).toContain("  session_id: none");
  });

  it("renders off_record as the boolean literal string", () => {
    const block = renderConvStateBlock({
      conv_id: "pi:abc",
      domain: "personal",
      session_id: "ses_1",
      off_record: true,
    });
    expect(block).toContain("  off_record: true");
  });

  it("falls back to `domain: unknown` (never the literal `undefined`) if a malformed row reaches the renderer at runtime", () => {
    // The type system blocks this at compile time; the cast simulates
    // a backend regression that drops `domain` from the wire payload.
    const malformed = {
      conv_id: "pi:abc",
      session_id: "ses_1",
      off_record: false,
    } as unknown as ConvStateRow;
    const block = renderConvStateBlock(malformed);
    expect(block).toContain("  domain: unknown");
    expect(block).not.toContain("undefined");
  });
});
