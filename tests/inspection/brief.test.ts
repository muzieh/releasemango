import { describe, expect, it } from "vitest";
import type { ScenarioDefinition } from "../../src/domain/scenarios/index.js";
import { createBrief } from "../../src/inspection/index.js";

const scenario = {
  schemaVersion: 1,
  metadata: { id: "tea", title: "Tea", description: "Ship tea safely" },
  seed: 1,
  workspace: { initialMain: "fixture" },
  ticketStatuses: [
    { id: "todo", name: "Todo" },
    { id: "done", name: "Done" },
  ],
  tickets: [
    { id: "TEA-1", title: "Brew", status: "done" },
    { id: "TEA-2", title: "Serve", status: "todo" },
  ],
  commits: [
    { id: "secret-commit", ticket: "TEA-1", message: "secret", dependsOn: [] },
  ],
  releases: {
    acceptance: {
      baseline: "acceptance",
      tickets: ["TEA-2", "TEA-1"],
      requiredChecks: ["hot"],
      forbiddenChecks: ["cold"],
    },
    production: {
      baseline: "production",
      tickets: ["TEA-1"],
      requiredChecks: ["tasty"],
      forbiddenChecks: [],
    },
  },
  checks: { required: [], forbidden: [] },
  hints: [
    {
      tier: 1,
      name: "concept" as const,
      fallback: "secret hint",
      variants: [],
    },
    {
      tier: 2,
      name: "investigation" as const,
      fallback: "inspect public state",
      variants: [],
    },
    {
      tier: 3,
      name: "guidance" as const,
      fallback: "trace ticket relationships",
      variants: [],
    },
  ],
  scoring: {
    weights: { required: 1, forbidden: 1, repository: 1, infrastructure: 1 },
    mandatoryChecks: [],
  },
} satisfies ScenarioDefinition;

describe("createBrief", () => {
  it("projects authored intent and status display names without spoilers", () => {
    const result = createBrief(scenario);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual({
      goal: "Ship tea safely",
      tickets: [
        { id: "TEA-1", title: "Brew", status: "Done" },
        { id: "TEA-2", title: "Serve", status: "Todo" },
      ],
      releases: {
        acceptance: {
          baseline: "acceptance",
          tickets: ["TEA-2", "TEA-1"],
          requiredChecks: ["hot"],
          forbiddenChecks: ["cold"],
        },
        production: {
          baseline: "production",
          tickets: ["TEA-1"],
          requiredChecks: ["tasty"],
          forbiddenChecks: [],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(Object.isFrozen(result.value.releases.acceptance.tickets)).toBe(
      true,
    );
  });

  it("returns a stable diagnostic for unsupported versions", () => {
    expect(
      createBrief({
        ...scenario,
        schemaVersion: 2,
      } as unknown as ScenarioDefinition),
    ).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "SCENARIO_VERSION_UNSUPPORTED",
          message: "Scenario schema version 2 is unsupported.",
        },
      ],
    });
  });
});
