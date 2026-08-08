import { describe, expect, it } from "vitest";
import type {
  EvaluationCheckResult,
  EvaluationResult,
} from "../../src/evaluator/index.js";
import { buildReport } from "../../src/reporting/index.js";

const evidence = Object.freeze({
  stdout: "",
  stderr: "",
  summary: "Public summary",
});
const check = (
  id: string,
  category: EvaluationCheckResult["category"],
  status: EvaluationCheckResult["status"],
  remediation?: string,
): EvaluationCheckResult =>
  Object.freeze({
    id,
    category,
    status,
    durationMs: 10,
    evidence,
    remediation,
  });
const evaluation = (
  checks: readonly EvaluationCheckResult[],
  termination: EvaluationResult["termination"] = "completed",
): EvaluationResult =>
  Object.freeze({
    status: checks.some((item) => item.status === "error")
      ? "error"
      : checks.some((item) => item.status === "fail")
        ? "fail"
        : "pass",
    termination,
    durationMs: 100,
    checks,
  });
const input = (
  checks: readonly EvaluationCheckResult[],
  weights = { required: 40, forbidden: 20, repository: 20, infrastructure: 20 },
  mandatoryChecks: readonly string[] = [],
) => ({
  scoring: { weights, mandatoryChecks },
  release: {
    branch: "release/acceptance",
    baseline: "refs/base",
    tickets: ["TEA-1"],
  },
  evaluation: evaluation(checks),
});

describe("buildReport", () => {
  it.each([
    [
      "perfect and empty categories",
      [check("a", "required", "pass")],
      100,
      "pass",
      "none",
    ],
    [
      "partial category",
      [check("a", "required", "pass"), check("b", "required", "fail")],
      80,
      "pass",
      "none",
    ],
    [
      "below threshold",
      [check("a", "required", "fail")],
      60,
      "fail",
      "warning",
    ],
  ] as const)("scores %s", (_name, checks, score, verdict, severity) => {
    expect(buildReport(input(checks))).toMatchObject({
      score,
      verdict,
      severity,
    });
  });

  it("sums unrounded shares and rounds an exact half upward only once", () => {
    const checks = [
      check("a", "required", "pass"),
      check("b", "required", "fail"),
    ];
    expect(
      buildReport(
        input(checks, {
          required: 39,
          forbidden: 20.5,
          repository: 20,
          infrastructure: 20.5,
        }),
      ).score,
    ).toBe(81);
  });

  it.each([
    [21, 79, "fail"],
    [20, 80, "pass"],
    [19, 81, "pass"],
  ] as const)(
    "applies the threshold at score %s",
    (required, score, verdict) => {
      expect(
        buildReport(
          input([check("a", "required", "fail")], {
            required,
            forbidden: 30,
            repository: 30,
            infrastructure: 40 - required,
          }),
        ),
      ).toMatchObject({ score, verdict });
    },
  );

  it("keeps a high score but blocks on a mandatory failure", () => {
    expect(
      buildReport(
        input(
          [check("gate", "required", "fail")],
          { required: 10, forbidden: 30, repository: 30, infrastructure: 30 },
          ["gate"],
        ),
      ),
    ).toMatchObject({ score: 90, verdict: "fail", severity: "blocking" });
  });

  it.each([
    [evaluation([check("infra", "infrastructure", "error")]), "error"],
    [evaluation([check("a", "required", "fail")], "cancelled"), "cancelled"],
  ] as const)("suppresses score for %s", (result, verdict) => {
    const report = buildReport({ ...input([]), evaluation: result });
    expect(report).toMatchObject({ verdict, severity: "system" });
    expect(report.score).toBeNull();
  });

  it("is immutable, duration-independent, ordered, and selects one safe action", () => {
    const failed = check(
      "a",
      "required",
      "fail",
      "Run `git reset --hard` then apply deadbeefdeadbeefdeadbeefdeadbeefdeadbeef.",
    );
    const first = buildReport(
      input([
        failed,
        check("b", "forbidden", "fail", "Review the public requirement."),
      ]),
    );
    const durationVariant = [
      { ...failed, durationMs: 999 },
      check("b", "forbidden", "fail", "Review the public requirement."),
    ];
    const second = buildReport({
      ...input(durationVariant),
      evaluation: { ...evaluation(durationVariant), durationMs: 9999 },
    });
    expect(first).toEqual(second);
    expect(
      first.groups.flatMap((group) => group.checks.map(({ id }) => id)),
    ).toEqual(["a", "b"]);
    expect(first.nextAction).toBe("Public summary");
    expect(Object.isFrozen(first.groups[0]?.checks)).toBe(true);
  });

  it("bounds evidence and removes hashes and authored commit IDs", () => {
    const result = buildReport({
      ...input([check("a", "required", "fail")]),
      authoredCommitIds: ["solution-commit"],
      evaluation: evaluation([
        {
          ...check("a", "required", "fail"),
          evidence: {
            stdout: `solution-commit ${"a".repeat(40)} ${"x".repeat(600)}`,
            stderr: "",
            summary: "Failed",
          },
        },
      ]),
    });
    const stdout = result.groups[0]?.checks[0]?.evidence.stdout ?? "";
    expect(stdout.length).toBeLessThanOrEqual(512);
    expect(stdout).not.toContain("solution-commit");
    expect(stdout).not.toContain("a".repeat(40));
  });
});
