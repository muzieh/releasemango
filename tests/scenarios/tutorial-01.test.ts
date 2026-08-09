import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadScenario } from "../../src/domain/scenarios/index.js";
import { generateWorkspace } from "../../src/generator/index.js";
import { createBrief, inspectStatus } from "../../src/inspection/index.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";

const checkout = new URL("../../", import.meta.url).pathname;
const scenarioPath = join(checkout, "scenarios/tutorial-01.yml");
const fixture = join(checkout, "fixtures/tiny-node-api");

describe("tutorial-01 curriculum", () => {
  it("loads the canonical, fixture-compatible teaching contract", async () => {
    const loaded = await loadScenario(scenarioPath, (path) =>
      readFile(path, "utf8"),
    );
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error(loaded.diagnostics[0]?.message);
    const scenario = loaded.value;
    expect(scenario.metadata).toMatchObject({ id: "tutorial-01" });
    expect(scenario.metadata.description).toContain("Git 2.39+");
    expect(scenario.metadata.description).toContain("Node.js 22+");
    expect(scenario.metadata.description).toContain("30–45 minutes");
    const manifest = JSON.parse(
      await readFile(join(fixture, "states.json"), "utf8"),
    ) as {
      units: Record<string, { requires: string[] }>;
    };
    expect(scenario.commits.map(({ id }) => id)).toEqual(
      Object.keys(manifest.units).filter((id) => id !== "semantic-resolution"),
    );
    for (const commit of scenario.commits)
      expect(commit.dependsOn).toEqual(manifest.units[commit.id]?.requires);
    expect(scenario.releases.acceptance.baseline).not.toBe(
      scenario.releases.production.baseline,
    );
    expect(scenario.releases.acceptance.tickets).not.toEqual(
      scenario.releases.production.tickets,
    );
    expect(scenario.releases.acceptance.requiredChecks).not.toEqual(
      scenario.releases.production.requiredChecks,
    );
    expect(scenario.hints.map(({ tier, name }) => [tier, name])).toEqual([
      [1, "concept"],
      [2, "investigation"],
      [3, "guidance"],
    ]);
    expect(Object.keys(scenario.scoring.weights).sort()).toEqual([
      "forbidden",
      "infrastructure",
      "repository",
      "required",
    ]);
    expect(
      Object.values(scenario.scoring.weights).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ).toBe(100);
    expect(scenario.scoring.mandatoryChecks).toEqual(
      expect.arrayContaining(["repository.clean", "repository.ancestry"]),
    );
  });

  it("generates a clean workspace without private reference assets", async () => {
    const loaded = await loadScenario(scenarioPath, (path) =>
      readFile(path, "utf8"),
    );
    if (!loaded.ok) throw new Error(loaded.diagnostics[0]?.message);
    await withTemporaryDirectory(async (parent) => {
      const destination = join(parent, "player");
      await generateWorkspace({
        scenario: loaded.value,
        fixture,
        destination,
        generatorVersion: "test",
      });
      const runGit = (...args: string[]): string =>
        execFileSync("git", args, { cwd: destination, encoding: "utf8" });
      const tracked = runGit("ls-files");
      expect(tracked).not.toMatch(/reference|judging|solution/iu);
      const refs = runGit(
        "for-each-ref",
        "--format=%(refname)",
        "refs/heads",
        "refs/releasemango",
      )
        .trim()
        .split("\n");
      expect(refs).not.toContainEqual(
        expect.stringMatching(/semantic-resolution|reference|solution/iu),
      );
      const reachable = [
        ...new Set(
          runGit("rev-list", ...refs)
            .trim()
            .split("\n"),
        ),
      ];
      for (const commit of reachable) {
        const message = runGit("show", "-s", "--format=%s", commit);
        const files = runGit("ls-tree", "-r", "--name-only", commit);
        const source = runGit("show", `${commit}:app.mjs`);
        expect(`${message}\n${files}`).not.toMatch(
          /semantic-resolution|reference|solution|reconcile both/iu,
        );
        expect(
          source.includes('audience: "internal"') &&
            source.includes('cache: "private"'),
        ).toBe(false);
      }
      const learnerSurfaces = JSON.stringify({
        brief: createBrief(loaded.value),
        status: await inspectStatus(destination),
        hints: loaded.value.hints,
      });
      expect(learnerSurfaces).not.toMatch(
        /semantic-resolution|reference|\bsolution\b|reconcile both/iu,
      );
    });
  });
});
