import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

const cli = resolve("dist/cli/index.js");
const acceptanceSource = (features: readonly string[]) =>
  `import { addRoute } from "./server.mjs";\n${features.includes("shared") ? 'import { jsonResponse } from "./json-response.mjs";\n' : ""}${features.includes("multi") ? 'import { multiResponse } from "./multi-response.mjs";\n' : ""}addRoute("/readiness", { status: 200, body: { ready: true, environment: "acceptance" } });\n${features.includes("greeting") ? 'addRoute("/greeting", { status: 200, body: { greeting: "hello" } });\n' : ""}${features.includes("multi") ? 'addRoute("/multi", { status: 200, body: multiResponse() });\n' : ""}${features.includes("shared") ? 'addRoute("/shared", { status: 200, body: jsonResponse({ feature: "dependent" }) });\n' : ""}`;
const productionSource = (cache: boolean) =>
  `import { addRoute } from "./server.mjs";\naddRoute("/readiness", { status: 200, body: { ready: true, environment: "production" } });\naddRoute("/policy", { status: 200, body: { audience: "internal"${cache ? ', cache: "private"' : ""} } });\n`;

interface Snapshot {
  branch: string;
  refs: string;
  index: string;
  status: string;
  tracked: string;
  ownership: string;
  worktrees: string;
}

function environment(root: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, "global.gitconfig"),
    GIT_AUTHOR_DATE: "2026-01-02T03:04:05Z",
    GIT_COMMITTER_DATE: "2026-01-02T03:04:05Z",
    GIT_EDITOR: "true",
  };
}

async function runCli(root: string, cwd: string, ...args: string[]) {
  return execa(process.execPath, [cli, ...args], {
    cwd,
    env: environment(root),
    reject: false,
    stripFinalNewline: false,
  });
}

async function git(root: string, repository: string, ...args: string[]) {
  return execa("git", args, {
    cwd: repository,
    env: environment(root),
    reject: false,
  });
}

async function gitOk(root: string, repository: string, ...args: string[]) {
  const result = await git(root, repository, ...args);
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

async function snapshot(root: string, repository: string): Promise<Snapshot> {
  return {
    branch: await gitOk(root, repository, "symbolic-ref", "--short", "HEAD"),
    refs: await gitOk(
      root,
      repository,
      "for-each-ref",
      "--sort=refname",
      "--format=%(refname) %(objectname)",
    ),
    index: await gitOk(root, repository, "write-tree"),
    status: await gitOk(
      root,
      repository,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ),
    tracked: await gitOk(root, repository, "diff", "HEAD", "--"),
    ownership: await readFile(
      join(repository, ".git/releasemango/ownership-v1.json"),
      "utf8",
    ),
    worktrees: await gitOk(root, repository, "worktree", "list", "--porcelain"),
  };
}

async function observeCli(
  root: string,
  repository: string,
  args: string[],
  hint = false,
) {
  const before = await snapshot(root, repository);
  const result = await runCli(root, repository, ...args);
  const after = await snapshot(root, repository);
  if (hint) {
    const beforeOwnership = JSON.parse(before.ownership) as Record<
      string,
      unknown
    >;
    const afterOwnership = JSON.parse(after.ownership) as Record<
      string,
      unknown
    >;
    expect(afterOwnership.nextHintTier).toBe(
      Number(beforeOwnership.nextHintTier) + 1,
    );
    expect({ ...after, ownership: before.ownership }).toEqual(before);
    expect({
      ...afterOwnership,
      nextHintTier: beforeOwnership.nextHintTier,
    }).toEqual(beforeOwnership);
  } else expect(after).toEqual(before);
  return result;
}

async function resolveConflict(
  root: string,
  repository: string,
  source: string,
  operation: "cherry-pick" | "merge",
) {
  expect(
    await gitOk(root, repository, "diff", "--name-only", "--diff-filter=U"),
  ).toBe("app.mjs");
  await writeFile(join(repository, "app.mjs"), source);
  await gitOk(root, repository, "add", "app.mjs");
  await gitOk(root, repository, operation, "--continue");
}

async function cherryPickConflict(
  root: string,
  repository: string,
  ref: string,
  source: string,
) {
  expect((await git(root, repository, "cherry-pick", ref)).exitCode).not.toBe(
    0,
  );
  await resolveConflict(root, repository, source, "cherry-pick");
}

function normalizeReport(report: Record<string, unknown>) {
  const groups = report.groups as {
    category: string;
    checks: { id: string; status: string }[];
  }[];
  return {
    schemaVersion: report.schemaVersion,
    score: report.score,
    verdict: report.verdict,
    nextAction: report.nextAction === null ? null : "action",
    checks: groups.flatMap((group) =>
      group.checks.map((check) => ({
        id: check.id,
        category: group.category,
        status: check.status,
      })),
    ),
  };
}

async function journey() {
  const root = await mkdtemp(join(tmpdir(), "releasemango-journey-"));
  const repository = join(root, "player");
  try {
    const generated = await runCli(
      root,
      root,
      "--json",
      "new",
      "tutorial-01",
      repository,
      "--seed",
      "16",
    );
    expect(generated).toMatchObject({ exitCode: 0, stderr: "" });

    const brief = await observeCli(root, repository, ["--json", "brief"]);
    const status = await observeCli(root, repository, ["--json", "status"]);
    const briefJson = JSON.parse(brief.stdout) as Record<string, unknown>;
    const statusJson = JSON.parse(status.stdout) as Record<string, unknown>;
    expect(briefJson).toMatchObject({
      schemaVersion: 1,
      command: "brief",
      ok: true,
    });
    expect(statusJson).toMatchObject({
      schemaVersion: 1,
      command: "status",
      ok: true,
    });

    await gitOk(root, repository, "config", "user.name", "Journey Learner");
    await gitOk(
      root,
      repository,
      "config",
      "user.email",
      "learner@example.test",
    );
    await gitOk(
      root,
      repository,
      "switch",
      "-C",
      "release/acceptance",
      "refs/releasemango/baselines/acceptance",
    );
    await writeFile(
      join(repository, "app.mjs"),
      `${acceptanceSource([])}addRoute("/debug", {});\n`,
    );
    await gitOk(root, repository, "add", "app.mjs");
    await gitOk(root, repository, "commit", "-m", "forbidden-debug");
    await gitOk(root, repository, "switch", "main");

    const acceptanceHuman = await observeCli(root, repository, [
      "evaluate",
      "acceptance",
    ]);
    expect(acceptanceHuman).toMatchObject({ exitCode: 1, stderr: "" });
    expect(acceptanceHuman.stdout).toContain("no-debug");
    expect(acceptanceHuman.stdout.length).toBeLessThan(4_096);
    const acceptanceFailed = await observeCli(root, repository, [
      "--json",
      "evaluate",
      "acceptance",
    ]);
    expect(acceptanceFailed).toMatchObject({ exitCode: 1, stderr: "" });
    const failedReport = JSON.parse(acceptanceFailed.stdout) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(failedReport)).not.toMatch(
      /judging|reference|commit [0-9a-f]{7}/i,
    );

    const hint = await observeCli(root, repository, ["--json", "hint"], true);
    const hintJson = JSON.parse(hint.stdout) as Record<string, unknown>;
    expect(hintJson).toMatchObject({
      schemaVersion: 1,
      state: "hint",
      tier: 1,
    });
    expect(hintJson.text).toEqual(expect.any(String));
    expect(String(hintJson.text)).not.toMatch(
      /judging|reference|cherry-pick|[0-9a-f]{40}/i,
    );

    await gitOk(
      root,
      repository,
      "switch",
      "-C",
      "release/acceptance",
      "refs/releasemango/baselines/acceptance",
    );
    await cherryPickConflict(
      root,
      repository,
      "refs/releasemango/commits/single-greeting",
      acceptanceSource(["greeting"]),
    );
    await cherryPickConflict(
      root,
      repository,
      "refs/releasemango/commits/multi-route",
      acceptanceSource(["greeting", "multi"]),
    );
    await gitOk(
      root,
      repository,
      "cherry-pick",
      "refs/releasemango/commits/multi-implementation",
    );
    await gitOk(
      root,
      repository,
      "cherry-pick",
      "refs/releasemango/commits/json-helper",
    );
    await cherryPickConflict(
      root,
      repository,
      "refs/releasemango/commits/dependent-feature",
      acceptanceSource(["greeting", "multi", "shared"]),
    );
    await gitOk(root, repository, "switch", "main");
    const acceptancePassed = await observeCli(root, repository, [
      "--json",
      "evaluate",
      "acceptance",
    ]);
    expect(acceptancePassed).toMatchObject({ exitCode: 0, stderr: "" });
    const acceptancePassJson = JSON.parse(acceptancePassed.stdout) as Record<
      string,
      unknown
    >;

    await gitOk(
      root,
      repository,
      "branch",
      "-f",
      "release/production",
      "refs/releasemango/baselines/acceptance",
    );
    const productionFailed = await observeCli(root, repository, [
      "--json",
      "evaluate",
      "production",
    ]);
    expect(productionFailed).toMatchObject({ exitCode: 1, stderr: "" });
    expect(productionFailed.stdout).toContain("repository.ancestry");

    await gitOk(
      root,
      repository,
      "switch",
      "-C",
      "release/production",
      "refs/releasemango/baselines/production",
    );
    expect(
      (
        await git(
          root,
          repository,
          "merge",
          "--no-ff",
          "refs/releasemango/commits/semantic-a",
        )
      ).exitCode,
    ).not.toBe(0);
    await resolveConflict(root, repository, productionSource(false), "merge");
    expect(
      (
        await git(
          root,
          repository,
          "merge",
          "--no-ff",
          "refs/releasemango/commits/semantic-b",
        )
      ).exitCode,
    ).not.toBe(0);
    await resolveConflict(root, repository, productionSource(true), "merge");
    await gitOk(root, repository, "switch", "main");
    const productionPassed = await observeCli(root, repository, [
      "--json",
      "evaluate",
      "production",
    ]);
    expect(productionPassed).toMatchObject({ exitCode: 0, stderr: "" });
    const productionPassJson = JSON.parse(productionPassed.stdout) as Record<
      string,
      unknown
    >;

    const final = await snapshot(root, repository);
    expect(final.status).toBe("");
    expect(final.worktrees.match(/^worktree /gm)).toHaveLength(1);
    expect(final.refs).not.toContain("refs/releasemango/evaluator");
    return {
      brief: {
        schemaVersion: briefJson.schemaVersion,
        command: briefJson.command,
      },
      status: {
        schemaVersion: statusJson.schemaVersion,
        command: statusJson.command,
        payload: statusJson.payload,
      },
      acceptanceFailure: normalizeReport(failedReport),
      hint: {
        schemaVersion: hintJson.schemaVersion,
        state: hintJson.state,
        tier: hintJson.tier,
        target: hintJson.target,
      },
      acceptancePass: normalizeReport(acceptancePassJson),
      productionFailure: normalizeReport(
        JSON.parse(productionFailed.stdout) as Record<string, unknown>,
      ),
      productionPass: normalizeReport(productionPassJson),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("tutorial-01 learner journey", () => {
  it("is deterministic across two isolated built-CLI and real-Git runs", async () => {
    const started = Date.now();
    const first = await journey();
    const second = await journey();
    expect(second).toEqual(first);
    expect(Date.now() - started).toBeLessThan(60_000);
  }, 60_000);
});
