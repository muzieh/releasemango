import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  evaluateAcceptanceRelease,
  evaluateProductionRelease,
} from "../../src/evaluator/index.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";
import {
  assembleAcceptance,
  assembleProduction,
  fixture,
  generateTutorial,
  pointRelease,
  status,
  trustedProductionRunner,
  tutorialScenario,
} from "../support/tutorial-01-reference.js";

describe("tutorial-01 private reference workflows", () => {
  for (const release of ["acceptance", "production"] as const) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      it(`${release} reference passes in fresh workspace ${String(attempt)}`, async () => {
        await withTemporaryDirectory(async (parent) => {
          const repository = join(parent, "player");
          await generateTutorial(repository);
          const workflow =
            release === "acceptance"
              ? await assembleAcceptance(repository)
              : await assembleProduction(repository);
          const scenario = await tutorialScenario();
          const result =
            release === "acceptance"
              ? await evaluateAcceptanceRelease({
                  repository,
                  scenario,
                  judgingBundle: fixture,
                })
              : await evaluateProductionRelease({
                  repository,
                  scenario,
                  runner: trustedProductionRunner(),
                });
          expect(result.status).toBe("pass");
          expect(workflow.beforeFinal.status).toBe("fail");
          expect(workflow.beforeFinal.checks).toContainEqual(
            expect.objectContaining({
              id: release === "acceptance" ? "shared" : "cache-policy",
              category: "required",
              status: "fail",
            }),
          );
          expect(workflow.appliedUnits).toEqual(
            release === "acceptance"
              ? [
                  "single-greeting",
                  "multi-route",
                  "multi-implementation",
                  "json-helper",
                  "dependent-feature",
                ]
              : ["semantic-a", "semantic-b"],
          );
          expect(workflow.descendsFromBaseline).toBe(true);
          expect(workflow.conflicts).toEqual([]);
          expect(await status(repository)).toBe("");
        });
      }, 20_000);
    }
  }

  it("classifies required, forbidden, repository, and infrastructure negatives", async () => {
    await withTemporaryDirectory(async (parent) => {
      const repository = join(parent, "player");
      const generated = await generateTutorial(repository);
      const scenario = await tutorialScenario();
      await pointRelease(
        repository,
        "acceptance",
        generated.commits.acceptance ?? "",
      );
      const required = await evaluateAcceptanceRelease({
        repository,
        scenario,
        judgingBundle: fixture,
      });
      expect(required.checks).toContainEqual(
        expect.objectContaining({
          id: "greeting",
          category: "required",
          status: "fail",
        }),
      );

      await assembleAcceptance(repository);
      await import("node:child_process").then(({ execFileSync }) =>
        execFileSync("git", ["switch", "release/acceptance"], {
          cwd: repository,
        }),
      );
      const app = join(repository, "app.mjs");
      const source = await readFile(app, "utf8");
      await import("node:fs/promises").then(({ writeFile }) =>
        writeFile(app, `${source}\naddRoute("/debug", {});\n`),
      );
      await import("node:child_process").then(({ execFileSync }) => {
        execFileSync("git", ["add", "app.mjs"], { cwd: repository });
        execFileSync(
          "git",
          [
            "-c",
            "user.name=Teacher",
            "-c",
            "user.email=teacher@example.test",
            "commit",
            "-m",
            "negative forbidden",
          ],
          { cwd: repository },
        );
        execFileSync("git", ["switch", "main"], { cwd: repository });
      });
      const forbidden = await evaluateAcceptanceRelease({
        repository,
        scenario,
        judgingBundle: fixture,
      });
      expect(forbidden.checks).toContainEqual(
        expect.objectContaining({
          id: "no-debug",
          category: "forbidden",
          status: "fail",
        }),
      );

      await pointRelease(
        repository,
        "production",
        generated.commits["semantic-resolution"] ?? "",
      );
      const wrongBase = await evaluateProductionRelease({
        repository,
        scenario,
        runner: trustedProductionRunner(),
      });
      expect(wrongBase.checks).toContainEqual(
        expect.objectContaining({
          id: "repository.ancestry",
          category: "repository",
          status: "fail",
        }),
      );

      const infrastructure = await evaluateAcceptanceRelease({
        repository,
        scenario,
        judgingBundle: join(parent, "missing"),
      });
      expect(infrastructure.checks).toContainEqual(
        expect.objectContaining({
          category: "infrastructure",
          status: "error",
        }),
      );
    });
  }, 30_000);
});
