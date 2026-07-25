import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ScenarioDefinition } from "../../src/domain/scenarios/index.js";
import {
  generateWorkspace,
  GenerationError,
  OWNERSHIP_MANIFEST_PATH,
} from "../../src/generator/index.js";
import { createProcessRunner } from "../../src/git/index.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";

const fixture = new URL("../../fixtures/tiny-node-api/", import.meta.url)
  .pathname;
const scenario: ScenarioDefinition = {
  schemaVersion: 1,
  metadata: { id: "non-linear", title: "Non-linear", description: "Test" },
  seed: 17,
  workspace: { initialMain: "semantic-a" },
  ticketStatuses: [{ id: "ready", name: "Ready" }],
  tickets: [
    { id: "TEA-A", title: "A", status: "ready" },
    { id: "TEA-B", title: "B", status: "ready" },
    { id: "TEA-R", title: "Resolution", status: "ready" },
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
    acceptance: { baseline: "semantic-a", tickets: ["TEA-A"] },
    production: {
      baseline: "semantic-resolution",
      tickets: ["TEA-A", "TEA-B", "TEA-R"],
    },
  },
  checks: { required: [], forbidden: [] },
  hints: [{ tier: 1, text: "Inspect" }],
  scoring: { result: 100 },
};

async function runGit(repository: string, args: string[]): Promise<string> {
  const result = await createProcessRunner().run({
    executable: "git",
    args,
    cwd: repository,
  });
  if (result.kind !== "completed" || result.exitCode !== 0)
    throw new Error(result.stderr);
  return result.stdout.trim();
}

describe("generateWorkspace", () => {
  it("generates deterministic non-linear history in paths containing spaces", async () => {
    await withTemporaryDirectory(async (parent) => {
      const first = await generateWorkspace({
        scenario,
        fixture,
        destination: join(parent, "repo one"),
        generatorVersion: "0.1.0",
      });
      const second = await generateWorkspace({
        scenario,
        fixture,
        destination: join(parent, "repo two"),
        generatorVersion: "0.1.0",
      });
      expect(first.commits).toEqual(second.commits);
      expect(first.refs).toEqual(second.refs);
      expect(await runGit(first.destination, ["status", "--porcelain"])).toBe(
        "",
      );
      expect(await runGit(first.destination, ["rev-parse", "main"])).toBe(
        first.commits["semantic-a"],
      );
      expect(
        await runGit(first.destination, ["rev-list", "--count", "--all"]),
      ).toBe("4");
      expect(
        JSON.parse(
          await readFile(
            join(first.destination, OWNERSHIP_MANIFEST_PATH),
            "utf8",
          ),
        ),
      ).toMatchObject({
        scenarioId: "non-linear",
        workspaceInitialMain: "semantic-a",
      });
    });
  });

  it("reports injected phases and leaves no first-generation destination", async () => {
    await withTemporaryDirectory(async (parent) => {
      const destination = join(parent, "failed");
      await expect(
        generateWorkspace({
          scenario,
          fixture,
          destination,
          generatorVersion: "0.1.0",
          failAt: "history",
        }),
      ).rejects.toMatchObject<Partial<GenerationError>>({ phase: "history" });
      await expect(readFile(destination)).rejects.toBeDefined();
    });
  });
});
