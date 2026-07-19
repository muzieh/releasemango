import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("CLI version", () => {
  beforeAll(async () => {
    await execFileAsync("pnpm", ["build"]);
  });

  it("prints the package version and exits successfully", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      version: string;
    };
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ["dist/cli/index.js", "--version"],
      { shell: false },
    );

    expect(stderr).toBe("");
    expect(stdout).toBe(`${packageJson.version}\n`);
  });
});
