import { describe, expect, it } from "vitest";
import { derivePiSourceRef } from "../extensions/librarian/source-ref.js";

describe("derivePiSourceRef", () => {
  it("uses device + session when both are present", () => {
    expect(derivePiSourceRef({ cwd: "/x", deviceId: "d1", piSessionId: "s1" })).toBe(
      "pi:device:d1:session:s1",
    );
  });

  it("falls back to device only", () => {
    expect(derivePiSourceRef({ cwd: "/x", deviceId: "d1" })).toBe("pi:device:d1");
  });

  it("falls back to session only", () => {
    expect(derivePiSourceRef({ cwd: "/x", piSessionId: "s1" })).toBe("pi:session:s1");
  });

  it("falls back to cwd when nothing else is available", () => {
    expect(derivePiSourceRef({ cwd: "/home/p" })).toBe("cwd:/home/p");
  });

  it("ignores blank ids", () => {
    expect(derivePiSourceRef({ cwd: "/x", deviceId: "  ", piSessionId: "" })).toBe("cwd:/x");
  });
});
