import { describe, expect, it } from "vitest";
import { renderHintHuman } from "../../src/hints/index.js";

describe("renderHintHuman", () => {
  it("renders a concise golden from the shared model", () => {
    expect(
      renderHintHuman({
        state: "hint",
        tier: 2,
        name: "investigation",
        target: {
          release: "acceptance",
          category: "required",
          check: "tests",
          ticket: "TEA-1",
        },
        text: "Inspect the public failure.",
        nextTier: 3,
      }),
    ).toBe(
      "Hint 2/3 — investigation\nTarget: acceptance / required / tests / TEA-1\nInspect the public failure.\n",
    );
  });
});
