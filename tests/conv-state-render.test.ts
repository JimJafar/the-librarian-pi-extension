import { describe, expect, it } from "vitest";
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
});
