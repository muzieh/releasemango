import { describe, expect, it } from "vitest";
import { checkGitSupport, type ProcessRunner } from "../../src/git/index.js";

const runnerFor = (stdout: string): ProcessRunner => ({
  run: (request) =>
    Promise.resolve({
      kind: "completed",
      executable: request.executable,
      args: [...request.args],
      cwd: request.cwd,
      exitCode: 0,
      stdout,
      stderr: "",
      termination: "exit",
    }),
});

describe("checkGitSupport", () => {
  it.each([
    ["git version 2.39.0", true],
    ["git version 2.45.1", true],
    ["git version 2.38.9", false],
    ["unexpected", false],
  ])("validates %s", async (output, supported) => {
    const result = await checkGitSupport(runnerFor(output), process.cwd());
    expect(result.supported).toBe(supported);
  });
});
