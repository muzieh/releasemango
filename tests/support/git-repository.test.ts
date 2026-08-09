import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withGitRepository } from "./git-repository.js";

describe("withGitRepository", () => {
  it("ignores poisoned Git configuration and creates deterministic commits", async () => {
    const ids: string[] = [];

    for (const name of ["first", "second"]) {
      await withGitRepository(async ({ git, paths }) => {
        const poison = [
          "[user]",
          `\tname = Poison ${name}`,
          `\temail = poison-${name}@example.test`,
          "[commit]",
          "\tgpgSign = true",
          "",
        ].join("\n");
        await writeFile(paths.globalConfig, poison);
        await writeFile(paths.systemConfig, poison);

        expect((await git.initialize("main")).ok).toBe(true);
        await writeFile(join(paths.repository, "file.txt"), "same\n");
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
        const log = await git.log();
        expect(log.ok && log.entries[0]).toMatchObject({
          author: { name: "Teacher", email: "teacher@example.test" },
          committer: { name: "Teacher", email: "teacher@example.test" },
        });
        await expect(readFile(paths.globalConfig, "utf8")).resolves.toBe(
          poison,
        );
        await expect(readFile(paths.systemConfig, "utf8")).resolves.toBe(
          poison,
        );
      });
    }

    expect(ids[0]).toBe(ids[1]);
  });
});
