import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScenario } from "../../src/domain/scenarios/index.js";
import {
  evaluateProductionRelease,
  PRODUCTION_BASELINE,
  PRODUCTION_BRANCH,
} from "../../src/evaluator/index.js";
import { createGitAdapter, createProcessRunner } from "../../src/git/index.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";

const identity = { name: "Teacher", email: "teacher@example.test" };
const timestamp = "2026-01-02T03:04:05Z";

describe("production release evaluator", () => {
  it("selects and copies only the declared production policy", async () => {
    await withTemporaryDirectory(async (repository) => {
      const git = createGitAdapter(repository);
      expect((await git.initialize("main")).ok).toBe(true);
      await writeFile(join(repository, "file.txt"), "production baseline\n");
      expect((await git.stage(["file.txt"])).ok).toBe(true);
      const commit = await git.commit({
        message: "production baseline",
        author: identity,
        authoredAt: timestamp,
        committer: identity,
        committedAt: timestamp,
      });
      expect(commit.ok).toBe(true);
      if (!commit.ok) return;
      expect((await git.createBranch(PRODUCTION_BRANCH)).ok).toBe(true);
      const runner = createProcessRunner();
      const ref = await runner.run({
        executable: "git",
        args: ["update-ref", PRODUCTION_BASELINE, commit.id],
        cwd: repository,
      });
      expect(ref.kind === "completed" && ref.exitCode === 0).toBe(true);
      const scenario = scenarioFixture();

      const result = await evaluateProductionRelease({
        repository,
        scenario,
      });

      expect(result).toMatchObject({
        status: "pass",
        termination: "completed",
        branch: PRODUCTION_BRANCH,
        baseline: PRODUCTION_BASELINE,
        tickets: ["TEA-2", "TEA-3"],
      });
      expect(result.checks.map(({ id }) => id)).toEqual([
        "repository.clean",
        "repository.conflicts",
        "repository.ancestry",
      ]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.tickets)).toBe(true);
      expect(result.tickets).not.toBe(scenario.releases.production.tickets);
    });
  });

  it("keeps missing branch and baseline outcomes distinguishable", async () => {
    await withTemporaryDirectory(async (repository) => {
      const git = createGitAdapter(repository);
      expect((await git.initialize("main")).ok).toBe(true);
      await writeFile(join(repository, "file.txt"), "baseline\n");
      expect((await git.stage(["file.txt"])).ok).toBe(true);
      const commit = await git.commit({
        message: "baseline",
        author: identity,
        authoredAt: timestamp,
        committer: identity,
        committedAt: timestamp,
      });
      expect(commit.ok).toBe(true);
      const missingBranch = await evaluateProductionRelease({
        repository,
        scenario: scenarioFixture(),
      });
      expect(missingBranch.checks[0]).toMatchObject({
        id: "repository.branch",
        category: "infrastructure",
        status: "error",
      });

      expect((await git.createBranch(PRODUCTION_BRANCH)).ok).toBe(true);
      const missingBaseline = await evaluateProductionRelease({
        repository,
        scenario: scenarioFixture(),
      });
      expect(missingBaseline.checks[0]).toMatchObject({
        id: "repository.baseline",
        category: "infrastructure",
        status: "error",
      });
    });
  });
});

function scenarioFixture() {
  const parsed = parseScenario(
    JSON.stringify({
      schemaVersion: 1,
      metadata: { id: "production", title: "Production", description: "Test" },
      seed: 1,
      workspace: { initialMain: "c1" },
      ticketStatuses: [{ id: "done", name: "Done" }],
      tickets: [
        { id: "TEA-1", title: "Acceptance", status: "done" },
        { id: "TEA-2", title: "Production A", status: "done" },
        { id: "TEA-3", title: "Production B", status: "done" },
      ],
      commits: [
        { id: "c1", ticket: "TEA-1", message: "one", dependsOn: [] },
        { id: "c2", ticket: "TEA-2", message: "two", dependsOn: ["c1"] },
        { id: "c3", ticket: "TEA-3", message: "three", dependsOn: ["c2"] },
      ],
      releases: {
        acceptance: { baseline: "c1", tickets: ["TEA-1"] },
        production: { baseline: "c3", tickets: ["TEA-2", "TEA-3"] },
      },
      checks: { required: [], forbidden: [] },
      hints: [{ tier: 1, text: "Fix it" }],
      scoring: { behavior: 100 },
    }),
  );
  if (!parsed.ok) throw new Error("Scenario fixture is invalid");
  return parsed.value;
}
