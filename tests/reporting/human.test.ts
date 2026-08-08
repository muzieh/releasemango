import { expect, it } from "vitest";
import { buildReport, renderHumanReport } from "../../src/reporting/index.js";

it("renders a concise report from the shared model", () => {
  const report = buildReport({
    scoring: {
      weights: {
        required: 100,
        forbidden: 0,
        repository: 0,
        infrastructure: 0,
      },
      mandatoryChecks: [],
    },
    release: {
      branch: "release/acceptance",
      baseline: "refs/base",
      tickets: ["TEA-1"],
    },
    evaluation: {
      status: "fail",
      termination: "completed",
      durationMs: 1,
      checks: [
        {
          id: "tests",
          category: "required",
          status: "fail",
          durationMs: 1,
          evidence: { stdout: "", stderr: "", summary: "Tests failed" },
          remediation: "Review the failing test.",
        },
      ],
    },
  });
  expect(renderHumanReport(report)).toBe(
    "Release: release/acceptance (refs/base)\nTickets: TEA-1\nVerdict: fail\nSeverity: warning\nScore: 0/100\nrequired\n  tests: fail — Tests failed\nNext action: Review the failing test.\n",
  );
});
