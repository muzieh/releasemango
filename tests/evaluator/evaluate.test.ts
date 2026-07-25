import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScenario } from "../../src/domain/scenarios/index.js";
import { evaluateBranch } from "../../src/evaluator/index.js";
import { createGitAdapter } from "../../src/git/index.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";

const identity = { name: "Teacher", email: "teacher@example.test" };
const timestamp = "2026-01-02T03:04:05Z";

describe("branch evaluator", () => {
  it("evaluates behavior and repository integrity in an isolated worktree", async () => {
    await withTemporaryDirectory(async (parent) => {
      const repository = join(parent, "player checkout");
      const git = createGitAdapter(repository);
      expect((await git.initialize("main")).ok).toBe(true);
      await writeFile(join(repository, "package.json"), '{"type":"module"}\n');
      await writeFile(join(repository, "check.mjs"), "process.exit(0)\n");
      expect((await git.stage(["package.json", "check.mjs"])).ok).toBe(true);
      const commit = await git.commit({
        message: "baseline",
        author: identity,
        authoredAt: timestamp,
        committer: identity,
        committedAt: timestamp,
      });
      expect(commit.ok).toBe(true);
      expect((await git.createBranch("solution")).ok).toBe(true);

      await writeFile(join(repository, "dirty.txt"), "player data\n");
      const before = await git.status();
      const scenario = parseScenario(
        JSON.stringify({
          schemaVersion: 1,
          metadata: { id: "test", title: "Test", description: "Test" },
          seed: 1,
          ticketStatuses: [{ id: "done", name: "Done" }],
          tickets: [{ id: "T-1", title: "Ticket", status: "done" }],
          commits: [{ id: "c1", ticket: "T-1", message: "x", dependsOn: [] }],
          releases: {
            acceptance: { baseline: "c1", tickets: ["T-1"] },
            production: { baseline: "c1", tickets: ["T-1"] },
          },
          checks: {
            required: [
              { id: "works", command: process.execPath, args: ["check.mjs"] },
            ],
            forbidden: [
              {
                id: "absent",
                command: process.execPath,
                args: ["-e", "process.exit(1)"],
              },
            ],
          },
          hints: [{ tier: 1, text: "Fix it" }],
          scoring: { behavior: 100 },
        }),
      );
      expect(scenario.ok).toBe(true);
      if (!scenario.ok || !commit.ok) return;

      const result = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "refs/heads/main",
        scenario: scenario.value,
      });

      expect(result.termination).toBe("completed");
      expect(result.status).toBe("pass");
      expect(result.checks.map(({ id }) => id)).toEqual([
        "works",
        "absent",
        "repository.clean",
        "repository.conflicts",
        "repository.ancestry",
      ]);
      expect(result.checks.every(Object.isFrozen)).toBe(true);
      expect(Object.isFrozen(result.checks)).toBe(true);
      expect(await git.status()).toEqual(before);
      const worktrees = await git.listWorktrees();
      expect(worktrees.ok).toBe(true);
      expect(worktrees.ok && worktrees.entries.length).toBe(1);
    });
  });

  it("reports a missing exact named branch as infrastructure error", async () => {
    await withTemporaryDirectory(async (repository) => {
      await mkdir(repository, { recursive: true });
      const git = createGitAdapter(repository);
      expect((await git.initialize("main")).ok).toBe(true);
      const scenario = parseScenario(
        JSON.stringify({
          schemaVersion: 1,
          metadata: { id: "test", title: "Test", description: "Test" },
          seed: 1,
          ticketStatuses: [{ id: "done", name: "Done" }],
          tickets: [{ id: "T-1", title: "Ticket", status: "done" }],
          commits: [{ id: "c1", ticket: "T-1", message: "x", dependsOn: [] }],
          releases: {
            acceptance: { baseline: "c1", tickets: ["T-1"] },
            production: { baseline: "c1", tickets: ["T-1"] },
          },
          checks: { required: [], forbidden: [] },
          hints: [{ tier: 1, text: "Fix it" }],
          scoring: { behavior: 100 },
        }),
      );
      expect(scenario.ok).toBe(true);
      if (!scenario.ok) return;
      const result = await evaluateBranch({
        repository,
        branch: "missing",
        baseline: "refs/heads/main",
        scenario: scenario.value,
      });
      expect(result).toMatchObject({
        status: "error",
        termination: "completed",
      });
      expect(result.checks[0]).toMatchObject({
        id: "repository.branch",
        category: "infrastructure",
        status: "error",
      });
    });
  });
});
