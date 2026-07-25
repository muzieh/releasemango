import { access } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createProcessRunner } from "../../src/git/index.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";

describe("process runner", () => {
  it("passes arguments literally and treats non-zero exit as completion", async () => {
    await withTemporaryDirectory(async (cwd) => {
      const marker = join(cwd, "marker");
      const argument = `;touch ${marker}`;
      const runner = createProcessRunner({
        allowedEnvironment: ["TEA_SECRET"],
      });
      const result = await runner.run({
        executable: process.execPath,
        args: ["-e", "console.log(process.argv[1]); process.exit(7)", argument],
        cwd,
        environment: { TEA_SECRET: "do-not-leak" },
      });

      expect(result).toMatchObject({
        kind: "completed",
        executable: process.execPath,
        args: ["-e", "console.log(process.argv[1]); process.exit(7)", argument],
        cwd,
        exitCode: 7,
        stdout: argument,
      });
      expect(JSON.stringify(result)).not.toContain("TEA_SECRET");
      expect(JSON.stringify(result)).not.toContain("do-not-leak");
      await expect(access(marker)).rejects.toThrow();
    });
  });

  it("distinguishes disallowed environment, spawn, timeout, and cancellation", async () => {
    const runner = createProcessRunner({ allowedEnvironment: [] });
    const cwd = process.cwd();
    await expect(
      runner.run({
        executable: process.execPath,
        args: [],
        cwd,
        environment: { SECRET: "hidden" },
      }),
    ).resolves.toMatchObject({ kind: "adapter-failed", exitCode: null });
    await expect(
      runner.run({ executable: "missing-tea-executable", args: [], cwd }),
    ).resolves.toMatchObject({ kind: "spawn-failed", exitCode: null });
    await expect(
      runner.run({
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd,
        timeoutMs: 30,
      }),
    ).resolves.toMatchObject({ kind: "timed-out", exitCode: null });

    const controller = new AbortController();
    setTimeout(() => {
      controller.abort();
    }, 30);
    await expect(
      runner.run({
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        cwd,
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({ kind: "cancelled", exitCode: null });
  });
});
