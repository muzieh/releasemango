import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { OWNERSHIP_MANIFEST_PATH } from "../../src/generator/index.js";
import { inspectStatus } from "../../src/inspection/index.js";

const run = promisify(execFile);
const roots: string[] = [];
afterEach(async () =>
  Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  ),
);
async function git(root: string, ...args: string[]): Promise<string> {
  return (
    await run("git", args, {
      cwd: root,
      env: {
        PATH: process.env.PATH,
        LANG: "C",
        LC_ALL: "C",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
      },
    })
  ).stdout.trim();
}
async function repository(): Promise<{
  root: string;
  manifest: Record<string, unknown>;
}> {
  const root = await mkdtemp(join(tmpdir(), "releasemango-status-"));
  roots.push(root);
  await git(root, "init", "--initial-branch", "main");
  await writeFile(join(root, "player.txt"), "tea\n");
  await git(root, "add", "player.txt");
  await git(
    root,
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-m",
    "initial",
  );
  const id = await git(root, "rev-parse", "HEAD");
  await git(root, "branch", "release/acceptance");
  await git(root, "branch", "release/production");
  await git(root, "update-ref", "refs/releasemango/baselines/acceptance", id);
  await git(root, "update-ref", "refs/releasemango/baselines/production", id);
  const generatedRefs: Record<string, string> = {};
  for (const line of (
    await git(root, "for-each-ref", "--format=%(refname) %(objectname)")
  ).split("\n")) {
    const separator = line.indexOf(" ");
    if (separator > 0)
      generatedRefs[line.slice(0, separator)] = line.slice(separator + 1);
  }
  const manifest = {
    schemaVersion: 2,
    scenarioId: "tea",
    seed: 1,
    generatorVersion: "test",
    fixture: "fixture",
    fixtureIdentity: "a".repeat(64),
    judgingBundle: { identity: "fixture", integrity: "a".repeat(64) },
    workspaceInitialMain: "fixture",
    nextHintTier: 1,
    generatedRefs,
  };
  await mkdir(join(root, ".git/releasemango"));
  await writeFile(
    join(root, OWNERSHIP_MANIFEST_PATH),
    JSON.stringify(manifest),
  );
  return { root, manifest };
}

async function fingerprint(root: string): Promise<object> {
  return {
    refs: await git(root, "show-ref"),
    head: await readFile(join(root, ".git/HEAD"), "base64"),
    index: await readFile(join(root, ".git/index"), "base64"),
    status: await git(root, "status", "--porcelain=v1", "-z"),
    manifest: await readFile(join(root, OWNERSHIP_MANIFEST_PATH), "base64"),
    player: await readFile(join(root, "player.txt"), "base64"),
  };
}

describe("inspectStatus", () => {
  it("reports branches, named HEAD, clean state, independent readiness, and stays read-only", async () => {
    const { root } = await repository();
    const before = await fingerprint(root);
    const result = await inspectStatus(root);
    expect(result).toMatchObject({
      ok: true,
      value: {
        head: { kind: "branch", name: "main" },
        branches: { main: true, acceptance: true, production: true },
        worktree: "clean",
        evaluation: {
          acceptance: { available: true },
          production: { available: true },
        },
      },
    });
    expect(await fingerprint(root)).toEqual(before);
  });

  it("reports detached and dirty states", async () => {
    const { root } = await repository();
    await git(root, "checkout", "--detach");
    await writeFile(join(root, "player.txt"), "changed\n");
    expect(await inspectStatus(root)).toMatchObject({
      ok: true,
      value: { head: { kind: "detached" }, worktree: "dirty" },
    });
  });

  it("makes only the affected target unavailable", async () => {
    const { root } = await repository();
    await git(
      root,
      "update-ref",
      "-d",
      "refs/releasemango/baselines/production",
    );
    expect(await inspectStatus(root)).toMatchObject({
      ok: true,
      value: {
        evaluation: {
          acceptance: { available: true },
          production: {
            available: false,
            reason: { code: "TARGET_BASELINE_MISSING" },
          },
        },
      },
    });
  });

  it("makes both targets unavailable when shared judging metadata is invalid", async () => {
    const { root, manifest } = await repository();
    const invalid = {
      ...manifest,
      judgingBundle: { identity: "", integrity: "" },
    };
    await writeFile(
      join(root, OWNERSHIP_MANIFEST_PATH),
      JSON.stringify(invalid),
    );
    expect(await inspectStatus(root)).toMatchObject({
      ok: true,
      value: {
        evaluation: {
          acceptance: {
            available: false,
            reason: { code: "JUDGING_METADATA_INVALID" },
          },
          production: {
            available: false,
            reason: { code: "JUDGING_METADATA_INVALID" },
          },
        },
      },
    });
  });

  it.each(["not-a-digest", "A".repeat(64), "a".repeat(63)])(
    "rejects malformed judging integrity %s",
    async (integrity) => {
      const { root, manifest } = await repository();
      await writeFile(
        join(root, OWNERSHIP_MANIFEST_PATH),
        JSON.stringify({
          ...manifest,
          judgingBundle: { identity: "fixture", integrity },
        }),
      );
      expect(await inspectStatus(root)).toMatchObject({
        ok: true,
        value: {
          evaluation: {
            acceptance: {
              available: false,
              reason: { code: "JUDGING_METADATA_INVALID" },
            },
            production: {
              available: false,
              reason: { code: "JUDGING_METADATA_INVALID" },
            },
          },
        },
      });
    },
  );

  it("reports a real merge conflict and preserves HEAD, refs, index, worktree, and metadata", async () => {
    const { root } = await repository();
    await git(root, "branch", "conflicting-change");
    await writeFile(join(root, "player.txt"), "main change\n");
    await git(root, "add", "player.txt");
    await git(
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "main change",
    );
    await git(root, "checkout", "conflicting-change");
    await writeFile(join(root, "player.txt"), "branch change\n");
    await git(root, "add", "player.txt");
    await git(
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      "branch change",
    );
    await git(root, "checkout", "main");
    await expect(
      git(
        root,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "merge",
        "--no-edit",
        "conflicting-change",
      ),
    ).rejects.toThrow();
    const before = await fingerprint(root);
    expect(await inspectStatus(root)).toMatchObject({
      ok: true,
      value: { worktree: "conflicted" },
    });
    expect(await fingerprint(root)).toEqual(before);
  });

  it("preserves repository state when inspection fails on malformed metadata", async () => {
    const { root } = await repository();
    await writeFile(join(root, OWNERSHIP_MANIFEST_PATH), "{");
    const before = await fingerprint(root);
    expect(await inspectStatus(root)).toMatchObject({
      ok: false,
      diagnostics: [{ code: "OWNERSHIP_MANIFEST_MALFORMED" }],
    });
    expect(await fingerprint(root)).toEqual(before);
  });

  it.each([
    ["missing", "OWNERSHIP_MANIFEST_MISSING", undefined],
    ["malformed", "OWNERSHIP_MANIFEST_MALFORMED", "{"],
    [
      "unsupported",
      "OWNERSHIP_MANIFEST_VERSION_UNSUPPORTED",
      '{"schemaVersion":3}',
    ],
  ])(
    "returns coded diagnostics for a %s manifest",
    async (_name, code, content) => {
      const root = await mkdtemp(join(tmpdir(), "releasemango-invalid-"));
      roots.push(root);
      if (content !== undefined) {
        await mkdir(join(root, ".git/releasemango"), { recursive: true });
        await writeFile(join(root, OWNERSHIP_MANIFEST_PATH), content);
      }
      expect(await inspectStatus(root)).toMatchObject({
        ok: false,
        diagnostics: [{ code }],
      });
    },
  );
});
