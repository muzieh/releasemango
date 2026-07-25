import { access, readFile } from "node:fs/promises";
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
    await withTemporaryDirectory(async (directory) => {
      const timeoutPidPath = join(directory, "timeout.pid");
      const timeout = runner.run({
        executable: process.execPath,
        args: [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)",
          timeoutPidPath,
        ],
        cwd,
        timeoutMs: 1_000,
      });
      const timeoutPid = await waitForPid(timeoutPidPath);
      const timeoutResult = await timeout;
      expect(timeoutResult).toMatchObject({
        kind: "timed-out",
        exitCode: null,
      });
      await expectProcessGone(timeoutPid);

      const cancellationPidPath = join(directory, "cancellation.pid");
      const controller = new AbortController();
      const cancellation = runner.run({
        executable: process.execPath,
        args: [
          "-e",
          "require('node:fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)",
          cancellationPidPath,
        ],
        cwd,
        signal: controller.signal,
      });
      const cancellationPid = await waitForPid(cancellationPidPath);
      controller.abort();
      await expect(cancellation).resolves.toMatchObject({
        kind: "cancelled",
        exitCode: null,
      });
      await expectProcessGone(cancellationPid);
    });
  });
});

async function readPid(path: string): Promise<number> {
  return Number(await readFile(path, "utf8"));
}

async function waitForPid(path: string): Promise<number> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      return await readPid(path);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Child did not publish PID at ${path}`);
}

async function expectProcessGone(pid: number): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 10));
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ESRCH"
      ) {
        return;
      }
      throw error;
    }
  }
  throw new Error(`Child process ${String(pid)} remained alive`);
}
