import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ScenarioDefinition } from "../../src/domain/scenarios/index.js";
import { loadScenario } from "../../src/domain/scenarios/index.js";
import {
  evaluateAcceptanceRelease,
  evaluateProductionRelease,
  type EvaluationResult,
} from "../../src/evaluator/index.js";
import { generateWorkspace } from "../../src/generator/index.js";
import {
  createProcessRunner,
  type ProcessRunner,
} from "../../src/git/index.js";

const execute = promisify(execFile);
export const checkout = new URL("../../", import.meta.url).pathname;
export const fixture = join(checkout, "fixtures/tiny-node-api");

export async function tutorialScenario(): Promise<ScenarioDefinition> {
  const result = await loadScenario(
    join(checkout, "scenarios/tutorial-01.yml"),
  );
  if (!result.ok) throw new Error(result.diagnostics[0]?.message);
  return result.value;
}

export async function generateTutorial(destination: string) {
  return generateWorkspace({
    scenario: await tutorialScenario(),
    fixture,
    destination,
    generatorVersion: "reference-test",
  });
}

async function git(repository: string, ...args: string[]): Promise<string> {
  const result = await execute("git", args, {
    cwd: repository,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_AUTHOR_DATE: "2026-01-02T03:04:05Z",
      GIT_COMMITTER_DATE: "2026-01-02T03:04:05Z",
      GIT_EDITOR: "true",
    },
  });
  return result.stdout.trim();
}

async function expectConflict(
  repository: string,
  args: string[],
): Promise<void> {
  await expectGitFailure(repository, args);
  const conflicts = await git(
    repository,
    "diff",
    "--name-only",
    "--diff-filter=U",
  );
  if (conflicts !== "app.mjs")
    throw new Error(`Expected only app.mjs to conflict, got '${conflicts}'.`);
}

async function expectGitFailure(
  repository: string,
  args: string[],
): Promise<void> {
  try {
    await git(repository, ...args);
  } catch {
    return;
  }
  throw new Error(`Expected git ${args.join(" ")} to fail.`);
}

async function resolve(
  repository: string,
  source: string,
  operation: "cherry-pick" | "merge",
): Promise<void> {
  await writeFile(join(repository, "app.mjs"), source);
  await git(repository, "add", "app.mjs");
  await git(repository, operation, "--continue");
}

const acceptanceSource = (
  features: readonly string[],
): string => `import { addRoute } from "./server.mjs";
${features.includes("shared") ? 'import { jsonResponse } from "./json-response.mjs";\n' : ""}${features.includes("multi") ? 'import { multiResponse } from "./multi-response.mjs";\n' : ""}addRoute("/readiness", { status: 200, body: { ready: true, environment: "acceptance" } });
${features.includes("greeting") ? 'addRoute("/greeting", { status: 200, body: { greeting: "hello" } });\n' : ""}${features.includes("multi") ? 'addRoute("/multi", { status: 200, body: multiResponse() });\n' : ""}${features.includes("shared") ? 'addRoute("/shared", { status: 200, body: jsonResponse({ feature: "dependent" }) });\n' : ""}`;

const productionSource = (
  cache: boolean,
): string => `import { addRoute } from "./server.mjs";
addRoute("/readiness", { status: 200, body: { ready: true, environment: "production" } });
addRoute("/policy", { status: 200, body: { audience: "internal"${cache ? ', cache: "private"' : ""} } });
`;

interface ReferenceResult {
  readonly beforeFinal: EvaluationResult;
  readonly appliedUnits: readonly string[];
  readonly descendsFromBaseline: boolean;
  readonly conflicts: readonly string[];
}

async function finishReference(
  repository: string,
  release: "acceptance" | "production",
  beforeFinal: EvaluationResult,
  appliedUnits: readonly string[],
): Promise<ReferenceResult> {
  const conflicts = (
    await git(repository, "diff", "--name-only", "--diff-filter=U")
  )
    .split("\n")
    .filter(Boolean);
  await git(
    repository,
    "merge-base",
    "--is-ancestor",
    `refs/releasemango/baselines/${release}`,
    `release/${release}`,
  );
  if (release === "acceptance") {
    const subjects = (
      await git(
        repository,
        "log",
        "--format=%s",
        `refs/releasemango/baselines/${release}..release/${release}`,
      )
    ).split("\n");
    const scenario = await tutorialScenario();
    for (const unit of appliedUnits) {
      const message = scenario.commits.find(({ id }) => id === unit)?.message;
      if (!message || !subjects.includes(message))
        throw new Error(
          `Release history does not contain authored unit '${unit}'.`,
        );
    }
  } else {
    for (const unit of appliedUnits)
      await git(
        repository,
        "merge-base",
        "--is-ancestor",
        `refs/releasemango/commits/${unit}`,
        `release/${release}`,
      );
  }
  await git(repository, "switch", "main");
  return { beforeFinal, appliedUnits, descendsFromBaseline: true, conflicts };
}

export async function assembleAcceptance(
  repository: string,
): Promise<ReferenceResult> {
  const scenario = await tutorialScenario();
  await git(repository, "config", "user.name", "Reference Teacher");
  await git(repository, "config", "user.email", "teacher@example.test");
  await git(
    repository,
    "switch",
    "-C",
    "release/acceptance",
    "refs/releasemango/baselines/acceptance",
  );

  await expectConflict(repository, [
    "cherry-pick",
    "refs/releasemango/commits/single-greeting",
  ]);
  await resolve(repository, acceptanceSource(["greeting"]), "cherry-pick");
  await expectConflict(repository, [
    "cherry-pick",
    "refs/releasemango/commits/multi-route",
  ]);
  await resolve(
    repository,
    acceptanceSource(["greeting", "multi"]),
    "cherry-pick",
  );
  await git(
    repository,
    "cherry-pick",
    "refs/releasemango/commits/multi-implementation",
  );
  await git(repository, "cherry-pick", "refs/releasemango/commits/json-helper");

  const beforeFinal = await evaluateAcceptanceRelease({
    repository,
    scenario,
    judgingBundle: fixture,
  });
  await expectConflict(repository, [
    "cherry-pick",
    "refs/releasemango/commits/dependent-feature",
  ]);
  await resolve(
    repository,
    acceptanceSource(["greeting", "multi", "shared"]),
    "cherry-pick",
  );

  return finishReference(repository, "acceptance", beforeFinal, [
    "single-greeting",
    "multi-route",
    "multi-implementation",
    "json-helper",
    "dependent-feature",
  ]);
}

export async function assembleProduction(
  repository: string,
): Promise<ReferenceResult> {
  const scenario = await tutorialScenario();
  await git(repository, "config", "user.name", "Reference Teacher");
  await git(repository, "config", "user.email", "teacher@example.test");
  await git(
    repository,
    "switch",
    "-C",
    "release/production",
    "refs/releasemango/baselines/production",
  );

  await expectConflict(repository, [
    "merge",
    "--no-ff",
    "refs/releasemango/commits/semantic-a",
  ]);
  await resolve(repository, productionSource(false), "merge");
  await expectConflict(repository, [
    "merge",
    "--no-ff",
    "refs/releasemango/commits/semantic-b",
  ]);
  const beforeFinal = await evaluateProductionRelease({
    repository,
    scenario,
    runner: trustedProductionRunner(),
  });
  await resolve(repository, productionSource(true), "merge");

  return finishReference(repository, "production", beforeFinal, [
    "semantic-a",
    "semantic-b",
  ]);
}

export async function status(repository: string): Promise<string> {
  return git(repository, "status", "--porcelain");
}

export function trustedProductionRunner(): ProcessRunner {
  const runner = createProcessRunner();
  return {
    run: (request) =>
      runner.run({
        ...request,
        args: request.args.map((argument) =>
          argument === "judging/check.mjs" ? join(fixture, argument) : argument,
        ),
      }),
  };
}

export async function pointRelease(
  repository: string,
  release: string,
  revision: string,
): Promise<void> {
  await git(repository, "branch", "-f", `release/${release}`, revision);
}
