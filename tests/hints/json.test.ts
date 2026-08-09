import { describe, expect, it } from "vitest";
import { renderHintJson } from "../../src/hints/index.js";

describe("renderHintJson", () => {
  it("has versioned stable bytes and key ordering", () => {
    expect(
      renderHintJson({
        state: "hint",
        tier: 1,
        name: "concept",
        target: null,
        text: "Look at public status.",
        nextTier: 2,
      }),
    ).toBe(
      '{"schemaVersion":1,"state":"hint","tier":1,"name":"concept","target":null,"text":"Look at public status.","nextTier":2}\n',
    );
  });
});
