import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScenarioDefinition } from "../../src/domain/scenarios/index.js";
import {
  ACCEPTANCE_BASELINE,
  ACCEPTANCE_BRANCH,
  evaluateAcceptanceRelease,
} from "../../src/evaluator/index.js";
import { generateWorkspace } from "../../src/generator/index.js";
import {
  createGitAdapter,
  createProcessRunner,
  type GitAdapter,
} from "../../src/git/index.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";

const fixture = new URL("../../fixtures/tiny-node-api/", import.meta.url)
  .pathname;

const scenario = (bundle: string): ScenarioDefinition => ({
  schemaVersion: 1,
  metadata: {
    id: "acceptance-policy",
    title: "Acceptance",
    description: "Test",
  },
  seed: 11,
  workspace: { initialMain: "semantic-a" },
  ticketStatuses: [{ id: "done", name: "Done" }],
  tickets: [
    { id: "TEA-A", title: "A", status: "done" },
    { id: "TEA-B", title: "B", status: "done" },
    { id: "TEA-R", title: "R", status: "done" },
  ],
  commits: [
    { id: "semantic-a", ticket: "TEA-A", message: "A", dependsOn: [] },
    { id: "semantic-b", ticket: "TEA-B", message: "B", dependsOn: [] },
    {
      id: "semantic-resolution",
      ticket: "TEA-R",
      message: "Resolve",
      dependsOn: ["semantic-a", "semantic-b"],
    },
  ],
  releases: {
    acceptance: {
      baseline: "semantic-a",
      tickets: ["TEA-A"],
      requiredChecks: ["cache", "audience"],
      forbiddenChecks: ["debug"],
    },
    production: {
      baseline: "semantic-resolution",
      tickets: ["TEA-A", "TEA-B", "TEA-R"],
      requiredChecks: ["production-only"],
      forbiddenChecks: [],
    },
  },
  checks: {
    required: [
      {
        id: "audience",
        command: process.execPath,
        args: ["judging/check.mjs", 'audience: "internal"'],
      },
      {
        id: "cache",
        command: process.execPath,
        args: ["judging/check.mjs", 'cache: "private"'],
      },
      {
        id: "production-only",
        command: process.execPath,
        args: ["judging/check.mjs", "never-present"],
      },
    ],
    forbidden: [
      {
        id: "debug",
        command: process.execPath,
        args: ["judging/check.mjs", "console.log"],
      },
    ],
  },
  hints: [
    { tier: 1, name: "concept" as const, fallback: bundle, variants: [] },
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
});

describe("acceptance release evaluator", () => {
  it("uses only acceptance-declared checks in authored order from the trusted bundle", async () => {
    await withTemporaryDirectory(async (parent) => {
      const repository = join(parent, "player");
      const generated = await generateWorkspace({
        scenario: scenario(fixture),
        fixture,
        destination: repository,
        generatorVersion: "0.1.0",
      });
      const git = createGitAdapter(repository);
      const solution = generated.commits["semantic-resolution"];
      if (!solution) throw new Error("Missing generated solution.");
      expect(
        (await git.updateRef(`refs/heads/${ACCEPTANCE_BRANCH}`, solution)).ok,
      ).toBe(true);
      const result = await evaluateAcceptanceRelease({
        repository,
        scenario: scenario(fixture),
        judgingBundle: fixture,
      });
      expect(result).toMatchObject({
        status: "pass",
        branch: ACCEPTANCE_BRANCH,
        baseline: ACCEPTANCE_BASELINE,
        tickets: ["TEA-A"],
        requiredChecks: ["cache", "audience"],
        forbiddenChecks: ["debug"],
      });
      expect(result.checks.map(({ id }) => id)).toEqual([
        "cache",
        "audience",
        "debug",
        "repository.clean",
        "repository.conflicts",
        "repository.ancestry",
      ]);
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.checks)).toBe(true);
    });
  }, 15_000);

  const matrix = [
    { name: "correct solution", source: "generated", status: "pass" },
    {
      name: "missing dependency",
      source: "semantic-a",
      status: "fail",
      failed: ["cache"],
    },
    {
      name: "incomplete multi-commit work",
      source: "incomplete",
      status: "fail",
      failed: ["cache"],
    },
    {
      name: "forbidden scope",
      source: "forbidden",
      status: "fail",
      failed: ["debug"],
    },
    {
      name: "wrong ancestry",
      source: "semantic-b",
      status: "fail",
      failed: ["audience", "repository.ancestry"],
    },
    {
      name: "unresolved conflict",
      source: "generated",
      status: "fail",
      failed: ["repository.clean", "repository.conflicts"],
      conflict: true,
    },
    {
      name: "equivalent squashed reimplementation",
      source: "equivalent",
      status: "pass",
    },
    {
      name: "tracked judging-copy replacement",
      source: "tracked-tamper",
      status: "fail",
      failed: ["cache"],
    },
  ] as const;

  for (const entry of matrix) {
    it(`evaluates ${entry.name} twice without mutating player state`, async () => {
      await withTemporaryDirectory(async (parent) => {
        const repository = join(parent, "player");
        const generated = await generateWorkspace({
          scenario: scenario(fixture),
          fixture,
          destination: repository,
          generatorVersion: "0.1.0",
        });
        const git = createGitAdapter(repository);
        const baseline = generated.commits["semantic-a"];
        const resolved = generated.commits["semantic-resolution"];
        const semanticB = generated.commits["semantic-b"];
        if (!baseline || !resolved || !semanticB)
          throw new Error("Missing generated matrix commit.");
        let candidate =
          entry.source === "semantic-a"
            ? baseline
            : entry.source === "semantic-b"
              ? semanticB
              : resolved;
        if (
          entry.source === "incomplete" ||
          entry.source === "forbidden" ||
          entry.source === "equivalent" ||
          entry.source === "tracked-tamper"
        ) {
          expect(
            (await git.updateRef(`refs/heads/${ACCEPTANCE_BRANCH}`, baseline))
              .ok,
          ).toBe(true);
          expect((await git.switchBranch(ACCEPTANCE_BRANCH)).ok).toBe(true);
          const equivalent =
            entry.source === "equivalent" || entry.source === "forbidden";
          await writeFile(
            join(repository, "app.mjs"),
            equivalent
              ? `// independent implementation\nconst policy = { audience: "internal", cache: "private" };\n${entry.source === "forbidden" ? "console.log(policy);\n" : "void policy;\n"}`
              : 'const policy = { audience: "internal" };\nvoid policy;\n',
          );
          const staged = ["app.mjs"];
          if (entry.source === "tracked-tamper") {
            await mkdir(join(repository, "judging"), { recursive: true });
            await writeFile(
              join(repository, "judging", "check.mjs"),
              "process.exit(0);\n",
            );
            staged.push("judging/check.mjs");
          }
          expect((await git.stage(staged)).ok).toBe(true);
          const committed = await git.commit({
            message: `matrix ${entry.name}`,
            author: { name: "Teacher", email: "teacher@example.test" },
            authoredAt: "2026-01-02T03:04:05Z",
            committer: { name: "Teacher", email: "teacher@example.test" },
            committedAt: "2026-01-02T03:04:05Z",
          });
          if (!committed.ok) throw new Error("Could not commit matrix state.");
          candidate = committed.id;
          expect((await git.switchBranch("main")).ok).toBe(true);
        }
        expect(
          (await git.updateRef(`refs/heads/${ACCEPTANCE_BRANCH}`, candidate))
            .ok,
        ).toBe(true);
        await writeFile(join(repository, "package.json"), '{"player":true}\n');
        expect((await git.stage(["package.json"])).ok).toBe(true);
        await writeFile(join(repository, "player-untracked"), "unchanged\n");
        const before = await playerSnapshot(repository);
        const normalized = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await evaluateAcceptanceRelease({
            repository,
            scenario: scenario(fixture),
            judgingBundle: fixture,
            ...(entry.conflict
              ? { createWorktreeGitAdapter: conflictingAdapter }
              : {}),
          });
          normalized.push(normalize(result));
          expect(result.status).toBe(entry.status);
          expect(result.checks.map(({ id }) => id)).not.toContain(
            "production-only",
          );
          expect(result.checks.map(({ id }) => id)).toEqual([
            "cache",
            "audience",
            "debug",
            "repository.clean",
            "repository.conflicts",
            "repository.ancestry",
          ]);
          for (const id of entry.failed ?? []) {
            const failed = result.checks.find((check) => check.id === id);
            expect(failed?.status).toBe("fail");
          }
          for (const check of result.checks)
            expect(check.evidence.summary.length).toBeLessThanOrEqual(4_096);
          expect(await playerSnapshot(repository)).toEqual(before);
        }
        expect(normalized[1]).toEqual(normalized[0]);
      });
    }, 20_000);
  }

  it("fails closed before execution when the external bundle is missing or changed", async () => {
    await withTemporaryDirectory(async (parent) => {
      const trusted = join(parent, "tiny-node-api");
      await cp(fixture, trusted, { recursive: true });
      const repository = join(parent, "player");
      await generateWorkspace({
        scenario: scenario(trusted),
        fixture: trusted,
        destination: repository,
        generatorVersion: "0.1.0",
      });
      await writeFile(
        join(trusted, "judging", "check.mjs"),
        `${await readFile(join(trusted, "judging", "check.mjs"), "utf8")}\n// changed\n`,
      );
      const before = await playerSnapshot(repository);
      for (const judgingBundle of [trusted, join(parent, "missing-bundle")]) {
        const results = [];
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const result = await evaluateAcceptanceRelease({
            repository,
            scenario: scenario(trusted),
            judgingBundle,
          });
          results.push(normalize(result));
          expect(result).toMatchObject({
            status: "error",
            checks: [
              {
                id: "infrastructure.judging-assets",
                category: "infrastructure",
                status: "error",
              },
            ],
          });
          expect(await playerSnapshot(repository)).toEqual(before);
        }
        expect(results[1]).toEqual(results[0]);
      }
    });
  }, 15_000);

  it("distinguishes missing acceptance branch and baseline without mutation", async () => {
    await withTemporaryDirectory(async (parent) => {
      const repository = join(parent, "player");
      const generated = await generateWorkspace({
        scenario: scenario(fixture),
        fixture,
        destination: repository,
        generatorVersion: "0.1.0",
      });
      const before = await playerSnapshot(repository);
      const missingBranchResults = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const missingBranch = await evaluateAcceptanceRelease({
          repository,
          scenario: scenario(fixture),
          judgingBundle: fixture,
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
      const solution = generated.commits["semantic-resolution"];
      if (!solution) throw new Error("Missing generated solution.");
      expect(
        (
          await createGitAdapter(repository).updateRef(
            `refs/heads/${ACCEPTANCE_BRANCH}`,
            solution,
          )
        ).ok,
      ).toBe(true);
      await runGit(repository, ["update-ref", "-d", ACCEPTANCE_BASELINE]);
      const branchBefore = await playerSnapshot(repository);
      const missingBaselineResults = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const missingBaseline = await evaluateAcceptanceRelease({
          repository,
          scenario: scenario(fixture),
          judgingBundle: fixture,
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
  }, 20_000);
});

function conflictingAdapter(repository: string): GitAdapter {
  const adapter = createGitAdapter(repository);
  return {
    ...adapter,
    status: () =>
      Promise.resolve({
        ok: true,
        entries: [{ path: "app.mjs", index: "U", worktree: "U" }],
      }),
  };
}

function normalize(
  result: Awaited<ReturnType<typeof evaluateAcceptanceRelease>>,
) {
  return {
    ...result,
    durationMs: 0,
    checks: result.checks.map((check) => ({ ...check, durationMs: 0 })),
  };
}

async function runGit(repository: string, args: readonly string[]) {
  const result = await createProcessRunner().run({
    executable: "git",
    args,
    cwd: repository,
  });
  if (result.kind !== "completed" || result.exitCode !== 0)
    throw new Error(`Git failed: ${args.join(" ")}`);
}

async function playerSnapshot(repository: string) {
  const inspect = async (args: readonly string[]) => {
    const result = await createProcessRunner().run({
      executable: "git",
      args,
      cwd: repository,
    });
    if (result.kind !== "completed" || result.exitCode !== 0)
      throw new Error(`Snapshot failed: ${args.join(" ")}`);
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
      package: await readFile(join(repository, "package.json"), "utf8"),
      untracked: await readFile(
        join(repository, "player-untracked"),
        "utf8",
      ).catch(() => ""),
    },
  };
}
