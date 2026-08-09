import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { ScenarioDefinition } from "../../src/domain/scenarios/index.js";
import { loadScenario } from "../../src/domain/scenarios/index.js";
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
    },
  });
  return result.stdout.trim();
}

async function commitCandidate(
  repository: string,
  release: string,
  source: string,
): Promise<void> {
  await git(
    repository,
    "switch",
    "-C",
    `release/${release}`,
    `refs/releasemango/baselines/${release}`,
  );
  await writeFile(join(repository, "app.mjs"), source);
  await git(repository, "add", "app.mjs");
  await git(
    repository,
    "-c",
    "user.name=Reference Teacher",
    "-c",
    "user.email=teacher@example.test",
    "commit",
    "-m",
    `Assemble ${release} candidate`,
  );
  await git(repository, "switch", "main");
}

export async function assembleAcceptance(repository: string): Promise<void> {
  await commitCandidate(
    repository,
    "acceptance",
    `import { addRoute } from "./server.mjs";
import { jsonResponse } from "./json-response.mjs";
import { multiResponse } from "./multi-response.mjs";
addRoute("/readiness", { status: 200, body: { ready: true, environment: "acceptance" } });
addRoute("/greeting", { status: 200, body: { greeting: "hello" } });
addRoute("/multi", { status: 200, body: multiResponse() });
addRoute("/shared", { status: 200, body: jsonResponse({ feature: "dependent" }) });
`,
  );
  await git(
    repository,
    "show",
    "refs/releasemango/commits/json-helper:json-response.mjs",
  ).then((source) =>
    writeFile(join(repository, "json-response.mjs"), `${source}\n`),
  );
  await git(
    repository,
    "show",
    "refs/releasemango/commits/multi-implementation:multi-response.mjs",
  ).then((source) =>
    writeFile(join(repository, "multi-response.mjs"), `${source}\n`),
  );
  await git(repository, "switch", "release/acceptance");
  await git(repository, "add", "json-response.mjs", "multi-response.mjs");
  await git(
    repository,
    "-c",
    "user.name=Reference Teacher",
    "-c",
    "user.email=teacher@example.test",
    "commit",
    "--amend",
    "--no-edit",
  );
  await git(repository, "switch", "main");
}

export async function assembleProduction(repository: string): Promise<void> {
  await commitCandidate(
    repository,
    "production",
    `import { addRoute } from "./server.mjs";
addRoute("/readiness", { status: 200, body: { ready: true, environment: "production" } });
addRoute("/policy", { status: 200, body: { audience: "internal", cache: "private" } });
`,
  );
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
