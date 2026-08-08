import { expect, it } from "vitest";
import { buildReport, serializeReportJson } from "../../src/reporting/index.js";

it("serializes a versioned byte-stable contract without durations", () => {
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
      branch: "release/production",
      baseline: "refs/base",
      tickets: ["TEA-1"],
    },
    evaluation: {
      status: "pass",
      termination: "completed",
      durationMs: 123,
      checks: [
        {
          id: "tests",
          category: "required",
          status: "pass",
          durationMs: 456,
          evidence: { stdout: "ok", stderr: "", summary: "Passed" },
        },
      ],
    },
  });
  const json = serializeReportJson(report);
  expect(json).toBe(serializeReportJson(report));
  expect(JSON.parse(json)).toMatchObject({
    schemaVersion: 1,
    score: 100,
    verdict: "pass",
    severity: "none",
    release: { tickets: ["TEA-1"] },
  });
  expect(json).not.toContain("duration");
});

it("does not serialize authored commit IDs from coaching", () => {
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
    authoredCommitIds: ["commit-a"],
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
          remediation: "Inspect commit-a to restore the behavior.",
        },
      ],
    },
  });

  expect(serializeReportJson(report)).not.toContain("commit-a");
});
