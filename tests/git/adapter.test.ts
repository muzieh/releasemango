import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitAdapter } from "../../src/git/index.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";

describe("Git adapter", () => {
  it("creates deterministic commits and exposes structured repository state", async () => {
    await withTemporaryDirectory(async (parent) => {
      const ids: string[] = [];
      for (const name of ["repo one", "repo two"]) {
        const repository = join(parent, name);
        const git = createGitAdapter(repository, {
          environment: {
            GIT_CONFIG_GLOBAL: join(parent, "missing-global"),
            GIT_CONFIG_SYSTEM: join(parent, "missing-system"),
          },
        });
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
        await writeFile(join(repository, "untracked.txt"), "x");
        const status = await git.status();
        expect(status.ok && status.entries[0]).toMatchObject({
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
      }
      expect(ids[0]).toBe(ids[1]);
    });
  });
});
