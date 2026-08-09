import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseScenario } from "../../src/domain/scenarios/index.js";
import {
  evaluateProductionRelease,
  PRODUCTION_BASELINE,
  PRODUCTION_BRANCH,
} from "../../src/evaluator/index.js";
import {
  createGitAdapter,
  createProcessRunner,
  type ProcessRunner,
} from "../../src/git/index.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";

const identity = { name: "Teacher", email: "teacher@example.test" };
const timestamp = "2026-01-02T03:04:05Z";
const behaviorIds = [
  "production",
  "semantic-a",
  "semantic-b",
  "no-acceptance",
  "no-incomplete",
];
const repositoryIds = [
  "repository.clean",
  "repository.conflicts",
  "repository.ancestry",
];

interface MatrixCase {
  readonly name: string;
  readonly state: State;
  readonly status: "pass" | "fail";
  readonly failed?: readonly string[];
  readonly acceptanceAncestry?: boolean;
  readonly alternativeHistory?: boolean;
}

interface State {
  readonly production: boolean;
  readonly acceptance: boolean;
  readonly incomplete: boolean;
  readonly semanticA: boolean;
  readonly semanticB: boolean;
}

const valid: State = {
  production: true,
  acceptance: false,
  incomplete: false,
  semanticA: true,
  semanticB: true,
};

describe("production release evaluator", () => {
  const matrix: readonly MatrixCase[] = [
    { name: "correct production", state: valid, status: "pass" },
    {
      name: "acceptance baseline only",
      state: valid,
      status: "fail",
      failed: ["repository.ancestry"],
      acceptanceAncestry: true,
    },
    {
      name: "acceptance behavior leakage",
      state: { ...valid, acceptance: true },
      status: "fail",
      failed: ["no-acceptance"],
    },
    {
      name: "missing production behavior",
      state: { ...valid, production: false },
      status: "fail",
      failed: ["production"],
    },
    {
      name: "reachable incomplete work",
      state: { ...valid, incomplete: true },
      status: "fail",
      failed: ["no-incomplete"],
    },
    {
      name: "semantic A lost after clean composition",
      state: { ...valid, semanticA: false },
      status: "fail",
      failed: ["semantic-a"],
    },
    {
      name: "semantic B lost after clean composition",
      state: { ...valid, semanticB: false },
      status: "fail",
      failed: ["semantic-b"],
    },
    { name: "semantic resolution", state: valid, status: "pass" },
    {
      name: "equivalent squashed reimplementation",
      state: valid,
      status: "pass",
      alternativeHistory: true,
    },
  ];

  for (const entry of matrix) {
    it(`evaluates ${entry.name} deterministically without mutating the player checkout`, async () => {
      await withTemporaryDirectory(async (repository) => {
        const setup = await createRepository(
          repository,
          entry.state,
          entry.acceptanceAncestry,
          entry.alternativeHistory,
        );
        if (entry.alternativeHistory) {
          expect(setup.canonicalSolution).toBeDefined();
          expect(setup.solution).not.toBe(setup.canonicalSolution);
        }
        const before = await playerSnapshot(repository);
        const results = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await evaluateProductionRelease({
            repository,
            scenario: scenarioFixture(),
          });
          results.push(normalize(result));
          expect(await playerSnapshot(repository)).toEqual(before);
          expect(result).toMatchObject({
            status: entry.status,
            termination: "completed",
            branch: PRODUCTION_BRANCH,
            baseline: PRODUCTION_BASELINE,
            tickets: ["TEA-2", "TEA-3"],
          });
          expect(result.checks.map(({ id }) => id)).toEqual([
            ...behaviorIds,
            ...repositoryIds,
          ]);
          expect(
            result.checks.map(({ id, category }) => [id, category]),
          ).toEqual([
            ["production", "required"],
            ["semantic-a", "required"],
            ["semantic-b", "required"],
            ["no-acceptance", "forbidden"],
            ["no-incomplete", "forbidden"],
            ["repository.clean", "repository"],
            ["repository.conflicts", "repository"],
            ["repository.ancestry", "repository"],
          ]);
          for (const id of entry.failed ?? []) {
            expect(result.checks).toContainEqual(
              expect.objectContaining({ id, status: "fail" }),
            );
          }
        }
        expect(results[1]).toEqual(results[0]);
        expect(setup.git).toBeDefined();
      });
    }, 15_000);
  }

  it("keeps cancellation deterministic and the dirty player checkout unchanged", async () => {
    await withTemporaryDirectory(async (repository) => {
      await createRepository(repository, valid);
      const before = await playerSnapshot(repository);
      const runner: ProcessRunner = {
        run: (request) =>
          Promise.resolve({
            kind: "cancelled",
            executable: request.executable,
            args: request.args,
            cwd: request.cwd,
            exitCode: null,
            stdout: "",
            stderr: "",
            termination: "cancellation",
            message: "Process was cancelled",
          }),
      };
      const results = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await evaluateProductionRelease({
          repository,
          scenario: scenarioFixture(),
          runner,
        });
        results.push(normalize(result));
        expect(result).toMatchObject({
          status: "error",
          termination: "cancelled",
          checks: [{ id: "production", category: "required", status: "error" }],
        });
        expect(await playerSnapshot(repository)).toEqual(before);
      }
      expect(results[1]).toEqual(results[0]);
    });
  });

  it("keeps injected infrastructure failure deterministic and isolated", async () => {
    await withTemporaryDirectory(async (repository) => {
      const { git } = await createRepository(repository, valid);
      const before = await playerSnapshot(repository);
      const failingGit = {
        ...git,
        isAncestor: () =>
          Promise.resolve({
            ok: false as const,
            operation: "is-ancestor",
            process: {
              kind: "spawn-failed" as const,
              executable: "git",
              args: [],
              cwd: repository,
              exitCode: null,
              stdout: "",
              stderr: "injected failure",
              termination: "spawn-failure" as const,
              message: "Git could not be started",
            },
          }),
      };
      const results = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = await evaluateProductionRelease({
          repository,
          scenario: scenarioFixture(),
          git: failingGit,
        });
        results.push(normalize(result));
        expect(result).toMatchObject({
          status: "error",
          termination: "completed",
        });
        expect(result.checks).toContainEqual(
          expect.objectContaining({
            id: "repository.ancestry",
            category: "infrastructure",
            status: "error",
          }),
        );
        expect(await playerSnapshot(repository)).toEqual(before);
      }
      expect(results[1]).toEqual(results[0]);
    });
  });

  it("keeps missing branch and baseline outcomes distinguishable and isolated", async () => {
    await withTemporaryDirectory(async (repository) => {
      const { git } = await createBase(repository);
      await dirtyPlayerCheckout(repository);
      const before = await playerSnapshot(repository);
      const missingBranchResults = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const missingBranch = await evaluateProductionRelease({
          repository,
          scenario: scenarioFixture(),
        });
        missingBranchResults.push(normalize(missingBranch));
        expect(missingBranch.checks[0]).toMatchObject({
          id: "repository.branch",
          category: "infrastructure",
          status: "error",
        });
        expect(await playerSnapshot(repository)).toEqual(before);
      }
      expect(missingBranchResults[1]).toEqual(missingBranchResults[0]);

      expect((await git.createBranch(PRODUCTION_BRANCH)).ok).toBe(true);
      const branchBefore = await playerSnapshot(repository);
      const missingBaselineResults = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const missingBaseline = await evaluateProductionRelease({
          repository,
          scenario: scenarioFixture(),
        });
        missingBaselineResults.push(normalize(missingBaseline));
        expect(missingBaseline.checks[0]).toMatchObject({
          id: "repository.baseline",
          category: "infrastructure",
          status: "error",
        });
        expect(await playerSnapshot(repository)).toEqual(branchBefore);
      }
      expect(missingBaselineResults[1]).toEqual(missingBaselineResults[0]);
    });
  });
});

async function createRepository(
  repository: string,
  state: State,
  acceptanceAncestry = false,
  alternativeHistory = false,
) {
  const { git, root } = await createBase(repository);
  if (acceptanceAncestry) {
    await writeFile(join(repository, "lineage.txt"), "production baseline\n");
    expect((await git.stage(["lineage.txt"])).ok).toBe(true);
    const production = await commit(git, "production baseline");
    expect((await git.updateRef(PRODUCTION_BASELINE, production)).ok).toBe(
      true,
    );
    expect((await git.updateRef(PRODUCTION_BRANCH_REF, root)).ok).toBe(true);
  } else {
    expect((await git.updateRef(PRODUCTION_BASELINE, root)).ok).toBe(true);
    expect((await git.updateRef(PRODUCTION_BRANCH_REF, root)).ok).toBe(true);
  }
  let canonicalSolution: string | undefined;
  if (alternativeHistory) {
    expect(
      (await git.updateRef("refs/heads/canonical-solution", root)).ok,
    ).toBe(true);
    expect((await git.switchBranch("canonical-solution")).ok).toBe(true);
    await writeFile(join(repository, "state.json"), JSON.stringify(state));
    expect((await git.stage(["state.json"])).ok).toBe(true);
    canonicalSolution = await commit(git, "observable production solution");
    expect((await git.switchBranch("main")).ok).toBe(true);
  }
  expect((await git.switchBranch(PRODUCTION_BRANCH)).ok).toBe(true);
  await writeFile(
    join(repository, "state.json"),
    alternativeHistory
      ? `${JSON.stringify(state, null, 2)}\n`
      : JSON.stringify(state),
  );
  expect((await git.stage(["state.json"])).ok).toBe(true);
  const solution = await commit(
    git,
    alternativeHistory
      ? "independent squashed production reimplementation"
      : "observable production solution",
  );
  expect((await git.switchBranch("main")).ok).toBe(true);
  await dirtyPlayerCheckout(repository);
  return { git, solution, canonicalSolution };
}

const PRODUCTION_BRANCH_REF = `refs/heads/${PRODUCTION_BRANCH}`;

async function createBase(repository: string) {
  const git = createGitAdapter(repository);
  expect((await git.initialize("main")).ok).toBe(true);
  await writeFile(join(repository, "tracked.txt"), "tracked baseline\n");
  await writeFile(join(repository, "staged.txt"), "staged baseline\n");
  await writeFile(join(repository, "unstaged.txt"), "unstaged baseline\n");
  await writeFile(
    join(repository, "check.mjs"),
    [
      "import { readFileSync } from 'node:fs';",
      "const state = JSON.parse(readFileSync('state.json', 'utf8'));",
      "const [key] = process.argv.slice(2);",
      "process.exit(state[key] ? 0 : 1);",
    ].join("\n"),
  );
  expect(
    (
      await git.stage([
        "tracked.txt",
        "staged.txt",
        "unstaged.txt",
        "check.mjs",
      ])
    ).ok,
  ).toBe(true);
  return { git, root: await commit(git, "root baseline") };
}

async function dirtyPlayerCheckout(repository: string) {
  const git = createGitAdapter(repository);
  await writeFile(join(repository, "staged.txt"), "player staged\n");
  expect((await git.stage(["staged.txt"])).ok).toBe(true);
  await writeFile(join(repository, "unstaged.txt"), "player unstaged\n");
  await writeFile(join(repository, "untracked.txt"), "player untracked\n");
}

async function commit(
  git: ReturnType<typeof createGitAdapter>,
  message: string,
) {
  const result = await git.commit({
    message,
    author: identity,
    authoredAt: timestamp,
    committer: identity,
    committedAt: timestamp,
  });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Could not commit ${message}`);
  return result.id;
}

function scenarioFixture() {
  const required = ["production", "semanticA", "semanticB"].map(
    (key, index) => ({
      id: behaviorIds[index],
      command: process.execPath,
      args: ["check.mjs", key],
    }),
  );
  const forbidden = ["acceptance", "incomplete"].map((key, index) => ({
    id: behaviorIds[index + 3],
    command: process.execPath,
    args: ["check.mjs", key],
  }));
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
        acceptance: {
          baseline: "c1",
          tickets: ["TEA-1"],
          requiredChecks: [],
          forbiddenChecks: [],
        },
        production: {
          baseline: "c3",
          tickets: ["TEA-2", "TEA-3"],
          requiredChecks: behaviorIds.slice(0, 3),
          forbiddenChecks: behaviorIds.slice(3),
        },
      },
      checks: { required, forbidden },
      hints: [
        { tier: 1, name: "concept" as const, fallback: "Fix it", variants: [] },
        {
          tier: 2,
          name: "investigation" as const,
          fallback: "Compare checks",
          variants: [],
        },
        {
          tier: 3,
          name: "guidance" as const,
          fallback: "Trace tickets",
          variants: [],
        },
      ],
      scoring: {
        weights: {
          required: 40,
          forbidden: 20,
          repository: 20,
          infrastructure: 20,
        },
        mandatoryChecks: [],
      },
    }),
  );
  if (!parsed.ok) throw new Error("Scenario fixture is invalid");
  return parsed.value;
}

function normalize(
  result: Awaited<ReturnType<typeof evaluateProductionRelease>>,
) {
  return {
    ...result,
    durationMs: 0,
    checks: result.checks.map((check) => ({ ...check, durationMs: 0 })),
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
