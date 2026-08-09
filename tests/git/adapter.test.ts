import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitAdapter } from "../../src/git/index.js";
import type { ProcessRunner } from "../../src/git/index.js";
import { withGitRepository } from "../support/git-repository.js";

describe("Git adapter", () => {
  it("creates deterministic commits and exposes structured repository state", async () => {
    const ids: string[] = [];
    for (const name of ["repo one", "repo two"]) {
      await withGitRepository(async ({ git, paths }) => {
        const repository = paths.repository;
        expect((await git.initialize("main")).ok).toBe(true);
        await writeFile(join(repository, "file.txt"), "same\n");
        expect((await git.stage(["file.txt"])).ok).toBe(true);
        const commit = await git.commit({
          message: "deterministic",
          author: { name: "Teacher", email: "teacher@example.test" },
          authoredAt: "2026-01-02T03:04:05Z",
          committer: { name: "Teacher", email: "teacher@example.test" },
          committedAt: "2026-01-02T03:04:05Z",
        });
        expect(commit.ok).toBe(true);
        if (!commit.ok) return;
        ids.push(commit.id);
        expect((await git.createBranch("feature")).ok).toBe(true);
        expect((await git.switchBranch("feature")).ok).toBe(true);
        await rename(
          join(repository, "file.txt"),
          join(repository, "new name.txt"),
        );
        expect((await git.stage(["file.txt", "new name.txt"])).ok).toBe(true);
        await writeFile(join(repository, "untracked.txt"), "x");
        const status = await git.status();
        expect(
          status.ok && status.entries.find(({ index }) => index === "R"),
        ).toMatchObject({
          path: "new name.txt",
          originalPath: "file.txt",
          index: "R",
          worktree: " ",
        });
        expect(
          status.ok &&
            status.entries.find(({ path }) => path === "untracked.txt"),
        ).toMatchObject({
          path: "untracked.txt",
          index: "?",
          worktree: "?",
        });
        const log = await git.log();
        expect(log.ok && log.entries[0]).toMatchObject({
          id: commit.id,
          message: "deterministic",
        });
        const ref = await git.resolveRef("HEAD");
        expect(ref.ok && ref.id).toBe(commit.id);
        const worktrees = await git.listWorktrees();
        expect(worktrees.ok && worktrees.entries[0]?.path).toBe(repository);
        const detached = join(paths.root, `${name} detached`);
        expect((await git.addDetachedWorktree(detached, commit.id)).ok).toBe(
          true,
        );
        expect(await git.isAncestor(commit.id, "refs/heads/feature")).toEqual({
          ok: true,
          isAncestor: true,
        });
        expect(
          await git.isAncestor("refs/heads/feature", `${commit.id}^`),
        ).toMatchObject({ ok: false, operation: "is-ancestor" });
        expect((await git.removeWorktree(detached)).ok).toBe(true);
      });
    }
    expect(ids[0]).toBe(ids[1]);
  });

  it("keeps the source path of copy records separate from following entries", async () => {
    const runner: ProcessRunner = {
      run(request) {
        return Promise.resolve({
          kind: "completed",
          executable: request.executable,
          args: request.args,
          cwd: request.cwd,
          exitCode: 0,
          stdout: "C  copied.txt\0source.txt\0?? untracked.txt\0",
          stderr: "",
          termination: "exit",
        });
      },
    };

    const status = await createGitAdapter("/unused", { runner }).status();

    expect(status).toEqual({
      ok: true,
      entries: [
        {
          index: "C",
          worktree: " ",
          path: "copied.txt",
          originalPath: "source.txt",
        },
        {
          index: "?",
          worktree: "?",
          path: "untracked.txt",
        },
      ],
    });
  });

  it("bounds Git processes by default", async () => {
    let timeoutMs: number | undefined;
    const runner: ProcessRunner = {
      run(request) {
        timeoutMs = request.timeoutMs;
        return Promise.resolve({
          kind: "completed",
          executable: request.executable,
          args: request.args,
          cwd: request.cwd,
          exitCode: 0,
          stdout: "0123456789abcdef\n",
          stderr: "",
          termination: "exit",
        });
      },
    };

    await createGitAdapter("/unused", { runner }).resolveRef("HEAD");

    expect(timeoutMs).toBe(20_000);
  });
});
