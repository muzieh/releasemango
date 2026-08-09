import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";
import {
  assembleAcceptance,
  assembleProduction,
} from "../support/tutorial-01-reference.js";

const cli = resolve("dist/cli/index.js");
const roots: string[] = [];

function cliEnvironment(
  cwd: string,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH,
    HOME: join(cwd, ".home"),
    XDG_CONFIG_HOME: join(cwd, ".config"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(cwd, ".gitconfig"),
    ...overrides,
  };
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "releasemango-cli-"));
  roots.push(root);
  return root;
}

async function run(args: string[], cwd: string) {
  return execa(process.execPath, [cli, ...args], {
    cwd,
    reject: false,
    env: cliEnvironment(cwd),
    stripFinalNewline: false,
  });
}

async function repositorySnapshot(repository: string) {
  const git = async (...args: string[]) =>
    (await execa("git", args, { cwd: repository })).stdout;
  return {
    branch: await git("symbolic-ref", "--short", "HEAD"),
    refs: await git("for-each-ref", "--format=%(refname) %(objectname)"),
    index: await git("write-tree"),
    status: await git("status", "--porcelain=v1", "--untracked-files=all"),
    tracked: await git("diff", "HEAD", "--"),
    ownership: await readFile(
      join(repository, ".git/releasemango/ownership-v1.json"),
      "utf8",
    ),
    worktrees: await git("worktree", "list", "--porcelain"),
  };
}

async function pointReleaseBranches(repository: string): Promise<void> {
  for (const target of ["acceptance", "production"])
    await execa(
      "git",
      [
        "branch",
        "-f",
        `release/${target}`,
        `refs/releasemango/baselines/${target}`,
      ],
      { cwd: repository },
    );
}

async function slowNodeEnvironment(root: string, cwd: string) {
  const directory = join(root, "slow-bin");
  await mkdir(directory);
  const executable = join(directory, "node");
  const marker = join(root, "child.pid");
  await writeFile(
    executable,
    `#!/bin/sh\nif [ ! -f "$RELEASEMANGO_TEST_CHILD_MARKER" ]; then\n  exec "${process.execPath}" -e 'require("node:fs").writeFileSync(process.env.RELEASEMANGO_TEST_CHILD_MARKER,String(process.pid));setTimeout(()=>{},30000)'\nfi\nexec "${process.execPath}" "$@"\n`,
  );
  await chmod(executable, 0o755);
  return {
    marker,
    env: cliEnvironment(cwd, {
      PATH: `${directory}:${process.env.PATH ?? ""}`,
      RELEASEMANGO_TEST_CHILD_MARKER: marker,
    }),
  };
}

async function waitForChild(marker: string): Promise<number> {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    try {
      return Number(await readFile(marker, "utf8"));
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw new Error("Evaluator child did not write its liveness marker.");
}

function expectChildGone(pid: number): void {
  try {
    process.kill(pid, 0);
  } catch (error) {
    expect((error as NodeJS.ErrnoException).code).toBe("ESRCH");
    return;
  }
  throw new Error(`Evaluator child ${String(pid)} is still alive.`);
}

afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);

describe("built CLI command surface", () => {
  it("lists every command and global JSON option", async () => {
    const result = await run(["--help"], await temporaryRoot());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("new [options] <scenario> [path]");
    expect(result.stdout).toContain("brief");
    expect(result.stdout).toContain("status");
    expect(result.stdout).toContain("hint");
    expect(result.stdout).toContain("evaluate <target>");
    expect(result.stdout).toContain("--json");
    expect(result.stderr).toBe("");
  });

  it("generates tutorial-01 and discovers it from a nested directory", async () => {
    const root = await temporaryRoot();
    const destination = join(root, "explicit-workspace");
    const generated = await run(
      ["--json", "new", "tutorial-01", destination, "--seed", "42"],
      root,
    );
    expect(generated.exitCode).toBe(0);
    expect(generated.stderr).toBe("");
    expect(JSON.parse(generated.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "new",
      ok: true,
      destination,
    });
    const overwritten = await run(
      [
        "--json",
        "new",
        "tutorial-01",
        destination,
        "--seed",
        "42",
        "--overwrite",
      ],
      root,
    );
    expect(overwritten).toMatchObject({ exitCode: 0, stderr: "" });
    const nested = join(destination, "nested");
    await mkdir(nested);
    const status = await run(["--json", "status"], nested);
    expect(status.exitCode).toBe(0);
    expect(status.stderr).toBe("");
    expect(JSON.parse(status.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "status",
      ok: true,
    });
    const brief = await run(["brief"], nested);
    expect(brief).toMatchObject({ exitCode: 0, stderr: "" });
    expect(brief.stdout).toContain("Goal:");
    const briefJson = await run(["--json", "brief"], nested);
    expect(JSON.parse(briefJson.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "brief",
      ok: true,
    });
    const statusHuman = await run(["status"], nested);
    expect(statusHuman).toMatchObject({ exitCode: 0, stderr: "" });
    expect(statusHuman.stdout).toContain("HEAD:");
    const hint = await run(["--json", "hint"], nested);
    expect(hint).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(hint.stdout)).toMatchObject({
      schemaVersion: 1,
      state: "hint",
      tier: 1,
    });
    const hintHuman = await run(["hint"], nested);
    expect(hintHuman).toMatchObject({ exitCode: 0, stderr: "" });
    expect(hintHuman.stdout).toContain("Hint 2/3");
    expect(
      JSON.parse(
        await readFile(
          join(destination, ".git/releasemango/ownership-v1.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ schemaVersion: 2, scenarioId: "tutorial-01", seed: 42 });
    await rm(nested, { recursive: true });
  });

  it("uses the default destination and repeats seeded generation exactly", async () => {
    const defaultRoot = await temporaryRoot();
    const defaultResult = await run(
      ["--json", "new", "tutorial-01"],
      defaultRoot,
    );
    expect(defaultResult).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(defaultResult.stdout)).toMatchObject({
      destination: "tutorial-01",
    });
    expect(
      JSON.parse(
        await readFile(
          join(defaultRoot, "tutorial-01/.git/releasemango/ownership-v1.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ scenarioId: "tutorial-01" });

    const root = await temporaryRoot();
    const first = join(root, "first");
    const second = join(root, "second");
    for (const destination of [first, second])
      expect(
        (await run(["new", "tutorial-01", destination, "--seed", "77"], root))
          .exitCode,
      ).toBe(0);
    const manifest = (repository: string) =>
      readFile(join(repository, ".git/releasemango/ownership-v1.json"), "utf8");
    expect(await manifest(second)).toBe(await manifest(first));
    const refs = async (repository: string) =>
      (
        await execa(
          "git",
          ["for-each-ref", "--format=%(refname) %(objectname)"],
          { cwd: repository },
        )
      ).stdout;
    expect(await refs(second)).toBe(await refs(first));
  });

  it("refuses and preserves an owned destination without overwrite", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "workspace");
    expect((await run(["new", "tutorial-01", repository], root)).exitCode).toBe(
      0,
    );
    const before = await repositorySnapshot(repository);
    const refused = await run(
      ["--json", "new", "tutorial-01", repository],
      root,
    );
    expect(refused).toMatchObject({ exitCode: 2, stderr: "" });
    expect(JSON.parse(refused.stdout)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "DESTINATION_UNSAFE" }],
    });
    expect(await repositorySnapshot(repository)).toEqual(before);
  });

  it("uses stable JSON diagnostics and usage exit code outside a workspace", async () => {
    const result = await run(["--json", "brief"], await temporaryRoot());
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      schemaVersion: 1,
      command: "brief",
      ok: false,
      diagnostics: [
        {
          code: "WORKSPACE_NOT_FOUND",
          message: "No Release Mango workspace was found.",
        },
      ],
    });
  });

  it("normalizes unknown inputs to usage diagnostics", async () => {
    const root = await temporaryRoot();
    for (const args of [
      ["--json", "new", "unknown"],
      ["--json", "evaluate", "unknown"],
      ["--json", "unknown"],
    ]) {
      const result = await run(args, root);
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toBe("");
      expect(JSON.parse(result.stdout)).toMatchObject({
        schemaVersion: 1,
        ok: false,
      });
    }
  });

  it("uses the exact evaluator exit matrix and preserves repository state", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "workspace");
    expect((await run(["new", "tutorial-01", repository], root)).exitCode).toBe(
      0,
    );
    const infrastructure = await run(
      ["--json", "evaluate", "acceptance"],
      repository,
    );
    expect(infrastructure).toMatchObject({ exitCode: 3, stderr: "" });
    expect(JSON.parse(infrastructure.stdout)).toMatchObject({
      verdict: "error",
    });
    await pointReleaseBranches(repository);
    const before = await repositorySnapshot(repository);

    for (const target of ["acceptance", "production"]) {
      const learnerFailure = await run(
        ["--json", "evaluate", target],
        repository,
      );
      expect(learnerFailure.exitCode).toBe(1);
      expect(learnerFailure.stderr).toBe("");
      expect(learnerFailure.stdout.endsWith("\n")).toBe(true);
      expect(learnerFailure.stdout.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(learnerFailure.stdout)).toMatchObject({
        schemaVersion: 1,
        verdict: "fail",
        release: { branch: `release/${target}` },
      });
    }
    expect(await repositorySnapshot(repository)).toEqual(before);

    const slow = await slowNodeEnvironment(root, repository);
    const timeoutProcess = execa(
      process.execPath,
      [cli, "--json", "evaluate", "production"],
      {
        cwd: repository,
        reject: false,
        env: slow.env,
        stripFinalNewline: false,
      },
    );
    const childPid = await waitForChild(slow.marker);
    const timedOut = await timeoutProcess;
    expect(timedOut.exitCode).toBe(3);
    expect(JSON.parse(timedOut.stdout)).toMatchObject({ schemaVersion: 1 });
    expectChildGone(childPid);
    expect(await repositorySnapshot(repository)).toEqual(before);
  }, 80_000);

  it("returns zero for passing acceptance and production reports", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "workspace");
    expect((await run(["new", "tutorial-01", repository], root)).exitCode).toBe(
      0,
    );
    await assembleAcceptance(repository);
    await assembleProduction(repository);
    for (const target of ["acceptance", "production"]) {
      const result = await run(["evaluate", target], repository);
      expect(result).toMatchObject({ exitCode: 0, stderr: "" });
      expect(result.stdout).toContain("Verdict: pass");
    }
  });

  it("returns 130 only after SIGINT cleanup and leaves the repository unchanged", async () => {
    const root = await temporaryRoot();
    const repository = join(root, "workspace");
    expect((await run(["new", "tutorial-01", repository], root)).exitCode).toBe(
      0,
    );
    await pointReleaseBranches(repository);
    const before = await repositorySnapshot(repository);
    const slow = await slowNodeEnvironment(root, repository);
    const child = execa(
      process.execPath,
      [cli, "--json", "evaluate", "acceptance"],
      {
        cwd: repository,
        reject: false,
        env: slow.env,
        stripFinalNewline: false,
      },
    );
    const evaluatorChildPid = await waitForChild(slow.marker);
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const current = await repositorySnapshot(repository);
      if (current.worktrees !== before.worktrees) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (child.pid === undefined) throw new Error("CLI subprocess has no PID.");
    process.kill(child.pid, "SIGINT");
    const result = await child;
    expect(result.exitCode).toBe(130);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toMatchObject({ verdict: "cancelled" });
    expectChildGone(evaluatorChildPid);
    expect(await repositorySnapshot(repository)).toEqual(before);
  });

  it("bounds malformed option, invalid ownership, unsafe destination, and missing Git diagnostics", async () => {
    const root = await temporaryRoot();
    const malformed = await run(
      ["--json", "new", "tutorial-01", "--seed", "nope"],
      root,
    );
    expect(malformed).toMatchObject({ exitCode: 2, stderr: "" });
    expect(malformed.stdout.length).toBeLessThan(512);
    const unsafe = join(root, "occupied");
    await mkdir(unsafe);
    await writeFile(join(unsafe, "keep.txt"), "user data\n");
    const occupied = await run(["--json", "new", "tutorial-01", unsafe], root);
    expect(occupied).toMatchObject({ exitCode: 2, stderr: "" });

    const missingGit = await execa(
      process.execPath,
      [cli, "--json", "new", "tutorial-01"],
      {
        cwd: root,
        reject: false,
        env: cliEnvironment(root, { PATH: "" }),
      },
    );
    expect(missingGit).toMatchObject({ exitCode: 3, stderr: "" });

    const repository = join(root, "workspace");
    expect((await run(["new", "tutorial-01", repository], root)).exitCode).toBe(
      0,
    );
    await rm(join(repository, ".git/releasemango/ownership-v1.json"));
    const invalid = await run(["--json", "status"], repository);
    expect(invalid).toMatchObject({ exitCode: 2, stderr: "" });
  });
});
