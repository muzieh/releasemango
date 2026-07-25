import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScenario } from "../../src/domain/scenarios/index.js";
import { evaluateBranch } from "../../src/evaluator/index.js";
import {
  createGitAdapter,
  createProcessRunner,
  type ProcessRunner,
} from "../../src/git/index.js";
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
      await writeFile(join(repository, "staged.txt"), "original staged\n");
      await writeFile(join(repository, "unstaged.txt"), "original unstaged\n");
      expect(
        (
          await git.stage([
            "package.json",
            "check.mjs",
            "staged.txt",
            "unstaged.txt",
          ])
        ).ok,
      ).toBe(true);
      const commit = await git.commit({
        message: "baseline",
        author: identity,
        authoredAt: timestamp,
        committer: identity,
        committedAt: timestamp,
      });
      expect(commit.ok).toBe(true);
      expect((await git.createBranch("solution")).ok).toBe(true);

      await writeFile(join(repository, "staged.txt"), "player staged\n");
      expect((await git.stage(["staged.txt"])).ok).toBe(true);
      await writeFile(join(repository, "unstaged.txt"), "player unstaged\n");
      await writeFile(join(repository, "untracked.txt"), "player untracked\n");
      const before = await playerSnapshot(repository);
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
      expect(await playerSnapshot(repository)).toEqual(before);
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

  it("rejects revision expressions instead of treating them as named baselines", async () => {
    await withTemporaryDirectory(async (repository) => {
      const { git, scenario } = await createRepository(repository);
      const result = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "HEAD",
        scenario,
      });
      expect(result).toMatchObject({
        status: "error",
        termination: "completed",
        checks: [
          {
            id: "repository.baseline",
            category: "infrastructure",
            status: "error",
          },
        ],
      });
      const worktrees = await git.listWorktrees();
      expect(worktrees.ok && worktrees.entries).toHaveLength(1);
    });
  });

  it("reports a missing exact baseline and preserves ancestry cancellation", async () => {
    await withTemporaryDirectory(async (repository) => {
      const { git, scenario } = await createRepository(repository);
      const missing = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "refs/heads/missing",
        scenario,
      });
      expect(missing.checks[0]).toMatchObject({
        id: "repository.baseline",
        status: "error",
      });

      const cancelledGit = {
        ...git,
        isAncestor: () =>
          Promise.resolve({
            ok: false as const,
            operation: "is-ancestor",
            process: cancelledProcess(repository),
          }),
      };
      const cancelled = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "refs/heads/main",
        scenario,
        git: cancelledGit,
      });
      expect(cancelled.termination).toBe("cancelled");
      const worktrees = await git.listWorktrees();
      expect(worktrees.ok && worktrees.entries).toHaveLength(1);
    });
  });

  it("preserves cancellation during worktree setup", async () => {
    await withTemporaryDirectory(async (repository) => {
      const { git, scenario } = await createRepository(repository);
      const cancelledGit = {
        ...git,
        addDetachedWorktree: () =>
          Promise.resolve({
            ok: false as const,
            operation: "add-detached-worktree",
            process: cancelledProcess(repository),
          }),
      };
      const result = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "refs/heads/main",
        scenario,
        git: cancelledGit,
      });
      expect(result.termination).toBe("cancelled");
      expect(result.checks[0]).toMatchObject({
        id: "repository.worktree",
        status: "error",
      });
    });
  });

  it("preserves cancellation during behavior execution and removes the worktree", async () => {
    await withTemporaryDirectory(async (repository) => {
      const { git, scenario } = await createRepository(repository, true);
      const runner: ProcessRunner = {
        run: (request) =>
          Promise.resolve(cancelledProcess(request.cwd, request)),
      };
      const result = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "refs/heads/main",
        scenario,
        runner,
      });
      expect(result.termination).toBe("cancelled");
      const worktrees = await git.listWorktrees();
      expect(worktrees.ok && worktrees.entries).toHaveLength(1);
    });
  });

  it("classifies required, forbidden, timeout, and spawn outcomes with bounded evidence", async () => {
    await withTemporaryDirectory(async (repository) => {
      const { git } = await createRepository(repository);
      const requests: Parameters<ProcessRunner["run"]>[0][] = [];
      const outcomes = [
        completedProcess(repository, 1),
        {
          ...cancelledProcess(repository),
          kind: "timed-out" as const,
          termination: "timeout" as const,
          stdout: "x".repeat(100),
          stderr: "secret-value",
          message: "Process timed out",
        },
        {
          ...cancelledProcess(repository),
          kind: "spawn-failed" as const,
          termination: "spawn-failure" as const,
          message: "Process could not be started",
        },
        completedProcess(repository, 0),
      ];
      const runner: ProcessRunner = {
        run(request) {
          requests.push(request);
          return Promise.resolve(
            outcomes.shift() ?? completedProcess(repository, 0),
          );
        },
      };
      const result = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "refs/heads/main",
        scenario: scenarioFor(
          [
            { id: "required-fail", command: "one", args: [] },
            { id: "timeout", command: "three", args: [] },
            { id: "spawn", command: "four", args: [] },
          ],
          [{ id: "forbidden-fail", command: "two", args: [] }],
        ),
        runner,
        evidenceLimit: 32,
      });
      expect(
        Object.fromEntries(result.checks.map(({ id, status }) => [id, status])),
      ).toMatchObject({
        "required-fail": "fail",
        "forbidden-fail": "fail",
        timeout: "fail",
        spawn: "error",
      });
      const timeout = result.checks.find(({ id }) => id === "timeout");
      expect(timeout?.evidence.stdout.length).toBeLessThanOrEqual(32);
      expect(
        requests.every((request) => request.environment === undefined),
      ).toBe(true);
      const worktrees = await git.listWorktrees();
      expect(worktrees.ok && worktrees.entries).toHaveLength(1);
    });
  });

  it("surfaces dirty evaluated state, invalid ancestry, setup failure, and cleanup failure", async () => {
    await withTemporaryDirectory(async (repository) => {
      const { git } = await createRepository(repository);
      const dirty = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "refs/heads/main",
        scenario: scenarioFor([
          {
            id: "dirty",
            command: process.execPath,
            args: [
              "-e",
              "require('node:fs').writeFileSync('generated.txt','dirty')",
            ],
          },
        ]),
      });
      expect(dirty.checks).toContainEqual(
        expect.objectContaining({ id: "repository.clean", status: "fail" }),
      );

      const conflict = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "refs/heads/main",
        scenario: scenarioFor([
          {
            id: "conflict",
            command: process.execPath,
            args: [
              "-e",
              "const c=require('node:child_process');const h=c.execFileSync('git',['rev-parse','HEAD:file.txt'],{encoding:'utf8'}).trim();c.execFileSync('git',['update-index','--index-info'],{input:`100644 ${h} 1\\tfile.txt\\n100644 ${h} 2\\tfile.txt\\n100644 ${h} 3\\tfile.txt\\n`})",
            ],
          },
        ]),
      });
      expect(conflict.checks).toContainEqual(
        expect.objectContaining({
          id: "repository.conflicts",
          status: "fail",
        }),
      );

      const nonAncestorGit = {
        ...git,
        isAncestor: () =>
          Promise.resolve({ ok: true as const, isAncestor: false }),
      };
      const ancestry = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "refs/heads/main",
        scenario: scenarioFor(),
        git: nonAncestorGit,
      });
      expect(ancestry.checks).toContainEqual(
        expect.objectContaining({ id: "repository.ancestry", status: "fail" }),
      );

      const setup = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "refs/heads/main",
        scenario: scenarioFor(),
        createTemporaryDirectory: () =>
          Promise.reject(new Error("injected setup failure")),
      });
      expect(setup.checks).toContainEqual(
        expect.objectContaining({ id: "repository.setup", status: "error" }),
      );

      const cleanupGit = {
        ...git,
        removeWorktree: async (path: string) => {
          const removed = await git.removeWorktree(path);
          expect(removed.ok).toBe(true);
          return {
            ok: false as const,
            operation: "remove-worktree",
            process: {
              ...completedProcess(repository, 1),
              stderr: "injected cleanup failure",
            },
          };
        },
      };
      const cleanup = await evaluateBranch({
        repository,
        branch: "solution",
        baseline: "refs/heads/main",
        scenario: scenarioFor(),
        git: cleanupGit,
      });
      expect(cleanup.checks).toContainEqual(
        expect.objectContaining({ id: "repository.cleanup", status: "error" }),
      );
    });
  });
});

async function createRepository(repository: string, withCheck = false) {
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
  expect((await git.createBranch("solution")).ok).toBe(true);
  return {
    git,
    scenario: scenarioFor(
      withCheck
        ? [{ id: "cancel", command: process.execPath, args: ["-v"] }]
        : [],
    ),
  };
}

function scenarioFor(
  required: readonly {
    id: string;
    command: string;
    args: readonly string[];
  }[] = [],
  forbidden: readonly {
    id: string;
    command: string;
    args: readonly string[];
  }[] = [],
) {
  const parsed = parseScenario(
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
      checks: { required, forbidden },
      hints: [{ tier: 1, text: "Fix it" }],
      scoring: { behavior: 100 },
    }),
  );
  if (!parsed.ok) throw new Error("Scenario fixture is invalid");
  return parsed.value;
}

function cancelledProcess(
  cwd: string,
  request: {
    readonly executable?: string;
    readonly args?: readonly string[];
  } = {},
) {
  return {
    kind: "cancelled" as const,
    executable: request.executable ?? "git",
    args: request.args ?? [],
    cwd,
    exitCode: null,
    stdout: "",
    stderr: "",
    termination: "cancellation" as const,
    message: "Process was cancelled",
  };
}

function completedProcess(cwd: string, exitCode: number) {
  return {
    kind: "completed" as const,
    executable: "fixture",
    args: [],
    cwd,
    exitCode,
    stdout: "",
    stderr: "",
    termination: "exit" as const,
  };
}

async function playerSnapshot(repository: string) {
  const runner = createProcessRunner();
  const inspect = async (args: readonly string[]) => {
    const result = await runner.run({
      executable: "git",
      args,
      cwd: repository,
    });
    if (result.kind !== "completed" || result.exitCode !== 0) {
      throw new Error(`Snapshot command failed: git ${args.join(" ")}`);
    }
    return result.stdout;
  };
  return {
    branch: await inspect(["symbolic-ref", "HEAD"]),
    head: await inspect(["rev-parse", "HEAD"]),
    index: await inspect(["ls-files", "--stage"]),
    status: await inspect([
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
    worktrees: await inspect(["worktree", "list", "--porcelain"]),
    files: {
      staged: await readFile(join(repository, "staged.txt"), "utf8"),
      unstaged: await readFile(join(repository, "unstaged.txt"), "utf8"),
      untracked: await readFile(join(repository, "untracked.txt"), "utf8"),
    },
  };
}
