import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fingerprintAssetBundle } from "../../src/generator/fingerprint.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";

describe("asset bundle fingerprint", () => {
  it("frames paths and contents so structurally different bundles cannot alias", async () => {
    await withTemporaryDirectory(async (parent) => {
      const left = join(parent, "left");
      const right = join(parent, "right");
      await mkdir(join(left, "judging"), { recursive: true });
      await mkdir(join(right, "judging"), { recursive: true });
      await writeFile(join(left, "judging", "x"), "yz");
      await writeFile(join(right, "judging", "xy"), "z");

      await expect(fingerprintAssetBundle(left)).resolves.not.toBe(
        await fingerprintAssetBundle(right),
      );
    });
  });
});
