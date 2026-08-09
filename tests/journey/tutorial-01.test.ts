import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa, type Options, type ResultPromise } from "execa";
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

class ProcessScope {
  readonly #controller = new AbortController();
  readonly #active = new Set<Promise<unknown>>();
  readonly #parent: AbortSignal;
  readonly #relay: () => void;

  constructor(parent: AbortSignal) {
    this.#parent = parent;
    this.#relay = () => {
      this.#controller.abort(parent.reason);
    };
    if (parent.aborted) this.#relay();
    else parent.addEventListener("abort", this.#relay, { once: true });
  }

  get activeCount(): number {
    return this.#active.size;
  }

  async run(
    file: string,
    args: string[],
    options: Options,
  ): Promise<Awaited<ResultPromise>> {
    const child = execa(file, args, {
      ...options,
      cancelSignal: this.#controller.signal,
      forceKillAfterDelay: 1_000,
    });
    this.#active.add(child);
    try {
      return await child;
    } finally {
      this.#active.delete(child);
    }
  }

  async close(): Promise<void> {
    this.#controller.abort(new Error("Journey process scope closed."));
    await Promise.allSettled([...this.#active]);
    this.#parent.removeEventListener("abort", this.#relay);
  }
}

function environment(root: string): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: join(root, "home"),
    XDG_CONFIG_HOME: join(root, "xdg"),
    TMPDIR: join(root, "tmp"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(root, "global.gitconfig"),
    GIT_AUTHOR_DATE: "2026-01-02T03:04:05Z",
    GIT_COMMITTER_DATE: "2026-01-02T03:04:05Z",
    GIT_EDITOR: "true",
  };
}

async function runCli(
  scope: ProcessScope,
  root: string,
  cwd: string,
  ...args: string[]
) {
  return scope.run(process.execPath, [cli, ...args], {
    cwd,
    env: environment(root),
    reject: false,
    stripFinalNewline: false,
  });
}

async function git(
  scope: ProcessScope,
  root: string,
  repository: string,
  ...args: string[]
) {
  return scope.run("git", args, {
    cwd: repository,
    env: environment(root),
    reject: false,
  });
}

async function gitOk(
  scope: ProcessScope,
  root: string,
  repository: string,
  ...args: string[]
) {
  const result = await git(scope, root, repository, ...args);
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${String(result.stderr)}`);
  return result.stdout;
}

async function snapshot(
  scope: ProcessScope,
  root: string,
  repository: string,
): Promise<Snapshot> {
  return {
    branch: await gitOk(
      scope,
      root,
      repository,
      "symbolic-ref",
      "--short",
      "HEAD",
    ),
    refs: await gitOk(
      scope,
      root,
      repository,
      "for-each-ref",
      "--sort=refname",
      "--format=%(refname) %(objectname)",
    ),
    index: await gitOk(scope, root, repository, "write-tree"),
    status: await gitOk(
      scope,
      root,
      repository,
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ),
    tracked: await gitOk(scope, root, repository, "diff", "HEAD", "--"),
    ownership: await readFile(
      join(repository, ".git/releasemango/ownership-v1.json"),
      "utf8",
    ),
    worktrees: await gitOk(
      scope,
      root,
      repository,
      "worktree",
      "list",
      "--porcelain",
    ),
  };
}

async function observeCli(
  scope: ProcessScope,
  root: string,
  repository: string,
  args: string[],
  hint = false,
) {
  const before = await snapshot(scope, root, repository);
  const result = await runCli(scope, root, repository, ...args);
  const after = await snapshot(scope, root, repository);
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
  scope: ProcessScope,
  root: string,
  repository: string,
  source: string,
  operation: "cherry-pick" | "merge",
) {
  expect(
    await gitOk(
      scope,
      root,
      repository,
      "diff",
      "--name-only",
      "--diff-filter=U",
    ),
  ).toBe("app.mjs");
  await writeFile(join(repository, "app.mjs"), source);
  await gitOk(scope, root, repository, "add", "app.mjs");
  await gitOk(scope, root, repository, operation, "--continue");
}

async function cherryPickConflict(
  scope: ProcessScope,
  root: string,
  repository: string,
  ref: string,
  source: string,
) {
  expect(
    (await git(scope, root, repository, "cherry-pick", ref)).exitCode,
  ).not.toBe(0);
  await resolveConflict(scope, root, repository, source, "cherry-pick");
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

async function expectNoTemporaryArtifacts(
  root: string,
  repository: string,
): Promise<void> {
  const rootEntries = await readdir(root);
  expect(rootEntries).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^\.player\.staging-/),
      expect.stringMatching(/^player\.backup-/),
    ]),
  );
  expect(await readdir(join(root, "tmp"))).toEqual([]);
  const metadataEntries = await readdir(join(repository, ".git/releasemango"), {
    recursive: true,
  }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
  expect(metadataEntries).not.toEqual(
    expect.arrayContaining([
      expect.stringMatching(/(?:^|\/)(?:.*\.lock|.*\.tmp-[^/]*)$/),
      expect.stringMatching(/(?:staging|backup|evaluation)/i),
    ]),
  );
}

async function journey(deadline: AbortSignal) {
  const root = await mkdtemp(join(tmpdir(), "releasemango-journey-"));
  const repository = join(root, "player");
  const scope = new ProcessScope(deadline);
  try {
    await mkdir(join(root, "tmp"));
    const generated = await runCli(
      scope,
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

    const brief = await observeCli(scope, root, repository, [
      "--json",
      "brief",
    ]);
    const status = await observeCli(scope, root, repository, [
      "--json",
      "status",
    ]);
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

    await gitOk(
      scope,
      root,
      repository,
      "config",
      "user.name",
      "Journey Learner",
    );
    await gitOk(
      scope,
      root,
      repository,
      "config",
      "user.email",
      "learner@example.test",
    );
    await gitOk(
      scope,
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
    await gitOk(scope, root, repository, "add", "app.mjs");
    await gitOk(scope, root, repository, "commit", "-m", "forbidden-debug");
    await gitOk(scope, root, repository, "switch", "main");

    const acceptanceHuman = await observeCli(scope, root, repository, [
      "evaluate",
      "acceptance",
    ]);
    expect(acceptanceHuman).toMatchObject({ exitCode: 1, stderr: "" });
    expect(acceptanceHuman.stdout).toContain("no-debug");
    expect(acceptanceHuman.stdout.length).toBeLessThan(4_096);
    const acceptanceFailed = await observeCli(scope, root, repository, [
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

    const hint = await observeCli(
      scope,
      root,
      repository,
      ["--json", "hint"],
      true,
    );
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
      scope,
      root,
      repository,
      "switch",
      "-C",
      "release/acceptance",
      "refs/releasemango/baselines/acceptance",
    );
    await cherryPickConflict(
      scope,
      root,
      repository,
      "refs/releasemango/commits/single-greeting",
      acceptanceSource(["greeting"]),
    );
    await cherryPickConflict(
      scope,
      root,
      repository,
      "refs/releasemango/commits/multi-route",
      acceptanceSource(["greeting", "multi"]),
    );
    await gitOk(
      scope,
      root,
      repository,
      "cherry-pick",
      "refs/releasemango/commits/multi-implementation",
    );
    await gitOk(
      scope,
      root,
      repository,
      "cherry-pick",
      "refs/releasemango/commits/json-helper",
    );
    await cherryPickConflict(
      scope,
      root,
      repository,
      "refs/releasemango/commits/dependent-feature",
      acceptanceSource(["greeting", "multi", "shared"]),
    );
    await gitOk(scope, root, repository, "switch", "main");
    const acceptancePassed = await observeCli(scope, root, repository, [
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
      scope,
      root,
      repository,
      "branch",
      "-f",
      "release/production",
      "refs/releasemango/baselines/acceptance",
    );
    const productionFailed = await observeCli(scope, root, repository, [
      "--json",
      "evaluate",
      "production",
    ]);
    expect(productionFailed).toMatchObject({ exitCode: 1, stderr: "" });
    expect(productionFailed.stdout).toContain("repository.ancestry");

    await gitOk(
      scope,
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
          scope,
          root,
          repository,
          "merge",
          "--no-ff",
          "refs/releasemango/commits/semantic-a",
        )
      ).exitCode,
    ).not.toBe(0);
    await resolveConflict(
      scope,
      root,
      repository,
      productionSource(false),
      "merge",
    );
    expect(
      (
        await git(
          scope,
          root,
          repository,
          "merge",
          "--no-ff",
          "refs/releasemango/commits/semantic-b",
        )
      ).exitCode,
    ).not.toBe(0);
    await resolveConflict(
      scope,
      root,
      repository,
      productionSource(true),
      "merge",
    );
    await gitOk(scope, root, repository, "switch", "main");
    const productionPassed = await observeCli(scope, root, repository, [
      "--json",
      "evaluate",
      "production",
    ]);
    expect(productionPassed).toMatchObject({ exitCode: 0, stderr: "" });
    const productionPassJson = JSON.parse(productionPassed.stdout) as Record<
      string,
      unknown
    >;

    const final = await snapshot(scope, root, repository);
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
    await scope.close();
    try {
      await expectNoTemporaryArtifacts(root, repository);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}

describe("tutorial-01 learner journey", () => {
  it("is deterministic across two isolated built-CLI and real-Git runs", async () => {
    const started = Date.now();
    const deadline = new AbortController();
    const timeout = setTimeout(() => {
      deadline.abort(new Error("The two-run journey exceeded 55 seconds."));
    }, 55_000);
    try {
      const first = await journey(deadline.signal);
      const second = await journey(deadline.signal);
      expect(second).toEqual(first);
      expect(Date.now() - started).toBeLessThan(60_000);
    } finally {
      clearTimeout(timeout);
      deadline.abort(new Error("The two-run journey finished."));
    }
  }, 60_000);

  it("cancels and awaits every tracked child before teardown", async () => {
    const deadline = new AbortController();
    const scope = new ProcessScope(deadline.signal);
    const running = scope.run(
      process.execPath,
      ["-e", "setInterval(() => undefined, 30_000)"],
      { reject: false },
    );
    expect(scope.activeCount).toBe(1);
    await scope.close();
    await running.catch(() => {
      return undefined;
    });
    expect(scope.activeCount).toBe(0);
  });
});
