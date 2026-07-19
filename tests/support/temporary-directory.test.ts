import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withTemporaryDirectory } from "./temporary-directory.js";

describe("withTemporaryDirectory", () => {
  it("uses an isolated directory and removes it after the callback", async () => {
    let temporaryPath = "";

    await withTemporaryDirectory(async (path) => {
      temporaryPath = path;
      await writeFile(join(path, "marker"), "isolated");
      await expect(access(join(path, "marker"))).resolves.toBeUndefined();
    });

    await expect(access(temporaryPath)).rejects.toThrow();
  });
});
