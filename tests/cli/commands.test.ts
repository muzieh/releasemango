import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, it } from "vitest";

const cli = resolve("dist/cli/index.js");
const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "releasemango-cli-"));
  roots.push(root);
  return root;
}

async function run(args: string[], cwd: string) {
  return execa(process.execPath, [cli, ...args], {
    cwd,
    reject: false,
    env: {
      PATH: process.env.PATH,
      HOME: join(cwd, ".home"),
      XDG_CONFIG_HOME: join(cwd, ".config"),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: join(cwd, ".gitconfig"),
    },
  });
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
    const generated = await run(["--json", "new", "tutorial-01"], root);
    expect(generated.exitCode).toBe(0);
    expect(generated.stderr).toBe("");
    expect(JSON.parse(generated.stdout)).toMatchObject({
      schemaVersion: 1,
      command: "new",
      ok: true,
      destination: "tutorial-01",
    });
    const nested = join(root, "tutorial-01", "nested");
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
    const hint = await run(["--json", "hint"], nested);
    expect(hint).toMatchObject({ exitCode: 0, stderr: "" });
    expect(JSON.parse(hint.stdout)).toMatchObject({
      schemaVersion: 1,
      state: "hint",
      tier: 1,
    });
    for (const target of ["acceptance", "production"]) {
      const evaluation = await run(["--json", "evaluate", target], nested);
      expect([0, 1, 3]).toContain(evaluation.exitCode);
      expect(evaluation.stderr).toBe("");
      expect(JSON.parse(evaluation.stdout)).toMatchObject({
        schemaVersion: 1,
        release: { branch: `release/${target}` },
      });
    }
    expect(
      JSON.parse(
        await readFile(
          join(root, "tutorial-01", ".git/releasemango/ownership-v1.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ schemaVersion: 2, scenarioId: "tutorial-01" });
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
});
