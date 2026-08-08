import { expect, it } from "vitest";
import { renderHuman } from "../../src/inspection/index.js";

it("renders every brief field", () => {
  expect(
    renderHuman("brief", {
      ok: true,
      value: {
        goal: "Ship tea",
        tickets: [{ id: "TEA-1", title: "Brew", status: "Done" }],
        releases: {
          acceptance: {
            baseline: "a",
            tickets: ["TEA-1"],
            requiredChecks: ["hot"],
            forbiddenChecks: ["cold"],
          },
          production: {
            baseline: "p",
            tickets: [],
            requiredChecks: [],
            forbiddenChecks: [],
          },
        },
      },
    }),
  ).toMatchInlineSnapshot(`
    "Goal: Ship tea
    Tickets:
      TEA-1: Brew [Done]
    Acceptance release (baseline: a)
      Tickets: TEA-1
      Required checks: hot
      Forbidden checks: cold
    Production release (baseline: p)
      Tickets: none
      Required checks: none
      Forbidden checks: none"
  `);
});

it("renders coded failures", () => {
  expect(
    renderHuman("status", {
      ok: false,
      diagnostics: [{ code: "WORKSPACE_INVALID", message: "Not generated." }],
    }),
  ).toBe("WORKSPACE_INVALID: Not generated.");
});
