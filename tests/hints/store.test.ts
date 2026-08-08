import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { requestHint } from "../../src/hints/index.js";

const request = (repository: string) => ({
  repository,
  scenario: {
    metadata: { id: "tutorial" },
    hints: [
      {
        tier: 1,
        name: "concept",
        fallback: "Inspect public status.",
        variants: [],
      },
      {
        tier: 2,
        name: "investigation",
        fallback: "Compare public checks.",
        variants: [],
      },
      {
        tier: 3,
        name: "guidance",
        fallback: "Trace ticket relationships.",
        variants: [],
      },
    ],
  } as never,
  status: {
    evaluation: {
      acceptance: { available: true },
      production: { available: true },
    },
  } as never,
  report: null,
});

describe("requestHint", () => {
  it("atomically advances only the owned counter and preserves unrelated fields", async () => {
    const repository = await mkdtemp(join(tmpdir(), "releasemango-hint-"));
    const directory = join(repository, ".git", "releasemango");
    await mkdir(directory, { recursive: true });
    const path = join(directory, "ownership-v1.json");
    await writeFile(
      path,
      JSON.stringify({
        schemaVersion: 2,
        scenarioId: "tutorial",
        nextHintTier: 1,
        unrelated: { keep: true },
      }) + "\n",
    );
    const result = await requestHint(request(repository));
    expect(result).toMatchObject({
      ok: true,
      value: { state: "hint", tier: 1, nextTier: 2 },
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      schemaVersion: 2,
      scenarioId: "tutorial",
      nextHintTier: 2,
      unrelated: { keep: true },
    });
  });

  it.each([
    ["missing", undefined, "hint.metadata-missing"],
    ["malformed", "{", "hint.metadata-malformed"],
    [
      "unsupported",
      JSON.stringify({
        schemaVersion: 99,
        scenarioId: "tutorial",
        nextHintTier: 1,
      }),
      "hint.metadata-unsupported",
    ],
  ])(
    "returns a stable diagnostic for %s metadata",
    async (_name, contents, code) => {
      const repository = await mkdtemp(join(tmpdir(), "releasemango-hint-"));
      const directory = join(repository, ".git", "releasemango");
      await mkdir(directory, { recursive: true });
      if (contents !== undefined)
        await writeFile(join(directory, "ownership-v1.json"), contents);
      await expect(requestHint(request(repository))).resolves.toEqual({
        ok: false,
        diagnostics: [expect.objectContaining({ code })],
      });
    },
  );
});
