import { expect, it } from "vitest";
import { renderJson } from "../../src/inspection/index.js";

it("renders exclusive deterministic v1 envelopes", () => {
  expect(
    JSON.parse(
      renderJson("brief", {
        ok: true,
        value: {
          goal: "Tea",
          tickets: [],
          releases: {
            acceptance: {
              baseline: "a",
              tickets: [],
              requiredChecks: [],
              forbiddenChecks: [],
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
    ),
  ).toEqual({
    schemaVersion: 1,
    command: "brief",
    ok: true,
    payload: {
      goal: "Tea",
      tickets: [],
      releases: {
        acceptance: {
          baseline: "a",
          tickets: [],
          requiredChecks: [],
          forbiddenChecks: [],
        },
        production: {
          baseline: "p",
          tickets: [],
          requiredChecks: [],
          forbiddenChecks: [],
        },
      },
    },
  });
  expect(
    JSON.parse(
      renderJson("status", {
        ok: false,
        diagnostics: [{ code: "WORKSPACE_NOT_FOUND", message: "Missing." }],
      }),
    ),
  ).toEqual({
    schemaVersion: 1,
    command: "status",
    ok: false,
    diagnostics: [{ code: "WORKSPACE_NOT_FOUND", message: "Missing." }],
  });
});
