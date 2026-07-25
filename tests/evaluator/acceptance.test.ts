import { cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ScenarioDefinition } from "../../src/domain/scenarios/index.js";
import {
  ACCEPTANCE_BASELINE,
  ACCEPTANCE_BRANCH,
  evaluateAcceptanceRelease,
} from "../../src/evaluator/index.js";
import { generateWorkspace } from "../../src/generator/index.js";
import { createGitAdapter } from "../../src/git/index.js";
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
  hints: [{ tier: 1, text: bundle }],
  scoring: { result: 100 },
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
      const result = await evaluateAcceptanceRelease({
        repository,
        scenario: scenario(trusted),
        judgingBundle: trusted,
      });
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
    });
  }, 15_000);
});
