import { describe, expect, it } from "vitest";
import type {
  HintTier,
  ScenarioDefinition,
} from "../../src/domain/scenarios/index.js";
import type { WorkspaceStatus } from "../../src/inspection/index.js";
import type { CoachingReport } from "../../src/reporting/index.js";
import { selectHint } from "../../src/hints/index.js";

const hints: readonly HintTier[] = [1, 2, 3].map((tier) => ({
  tier,
  name:
    (["concept", "investigation", "guidance"] as const)[tier - 1] ?? "concept",
  fallback: `fallback-${String(tier)}`,
  variants: [
    {
      selector: { release: "acceptance" as const },
      text: `release-${String(tier)}`,
    },
    {
      selector: { category: "required" as const },
      text: `category-${String(tier)}`,
    },
    { selector: { ticket: "TEA-1" }, text: `ticket-${String(tier)}` },
    { selector: { check: "tests" }, text: `check-${String(tier)}` },
  ],
}));
const scenario = { hints } as ScenarioDefinition;
const status = {
  evaluation: {
    acceptance: { available: true },
    production: { available: true },
  },
} as WorkspaceStatus;
const report = (
  verdict: CoachingReport["verdict"] = "fail",
): CoachingReport => ({
  release: {
    branch: "release/acceptance",
    baseline: "refs/base",
    tickets: ["TEA-1"],
  },
  score: verdict === "pass" ? 100 : 50,
  verdict,
  severity: verdict === "pass" ? "none" : "blocking",
  groups: [
    {
      category: "required",
      checks: [
        {
          id: "first",
          status: "pass",
          evidence: { stdout: "", stderr: "", summary: "" },
        },
        {
          id: "tests",
          status: "fail",
          evidence: { stdout: "", stderr: "", summary: "failed" },
        },
      ],
    },
  ],
  nextAction: null,
});

describe("selectHint", () => {
  it("uses fallback without a report and remains deterministic and immutable", () => {
    const first = selectHint({ scenario, status, report: null, nextTier: 1 });
    expect(first).toMatchObject({
      state: "hint",
      tier: 1,
      text: "fallback-1",
      nextTier: 2,
    });
    expect(selectHint({ scenario, status, report: null, nextTier: 1 })).toEqual(
      first,
    );
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("targets first non-pass and uses check over ticket, category, and release", () => {
    expect(
      selectHint({ scenario, status, report: report(), nextTier: 2 }),
    ).toMatchObject({
      state: "hint",
      tier: 2,
      text: "check-2",
      target: {
        release: "acceptance",
        category: "required",
        check: "tests",
        ticket: "TEA-1",
      },
      nextTier: 3,
    });
  });

  it("returns solved and exhausted without advancing", () => {
    expect(
      selectHint({ scenario, status, report: report("pass"), nextTier: 1 }),
    ).toEqual({ state: "solved", nextTier: 1 });
    expect(
      selectHint({ scenario, status, report: report(), nextTier: 4 }),
    ).toEqual({ state: "exhausted", nextTier: 4 });
  });
});
