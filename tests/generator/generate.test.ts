import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { ScenarioDefinition } from "../../src/domain/scenarios/index.js";
import {
  generateWorkspace,
  GenerationError,
  OWNERSHIP_MANIFEST_PATH,
} from "../../src/generator/index.js";
import { createProcessRunner } from "../../src/git/index.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";

const fixture = new URL("../../fixtures/tiny-node-api/", import.meta.url)
  .pathname;
const checkout = new URL("../../", import.meta.url).pathname;
const scenario: ScenarioDefinition = {
  schemaVersion: 1,
  metadata: { id: "non-linear", title: "Non-linear", description: "Test" },
  seed: 17,
  workspace: { initialMain: "semantic-a" },
  ticketStatuses: [{ id: "ready", name: "Ready" }],
  tickets: [
    { id: "TEA-A", title: "A", status: "ready" },
    { id: "TEA-B", title: "B", status: "ready" },
    { id: "TEA-R", title: "Resolution", status: "ready" },
  ],
  commits: [
    { id: "semantic-a", ticket: "TEA-A", message: "A", dependsOn: [] },
    { id: "semantic-b", ticket: "TEA-B", message: "B", dependsOn: [] },
    {
      id: "semantic-resolution",
      ticket: "TEA-R",
      message: "Resolve",
      dependsOn: ["semantic-a", "semantic-b"],
    },
  ],
  releases: {
    acceptance: {
      baseline: "semantic-a",
      tickets: ["TEA-A"],
      requiredChecks: [],
      forbiddenChecks: [],
    },
    production: {
      baseline: "semantic-resolution",
      tickets: ["TEA-A", "TEA-B", "TEA-R"],
      requiredChecks: [],
      forbiddenChecks: [],
    },
  },
  checks: { required: [], forbidden: [] },
  hints: [{ tier: 1, text: "Inspect" }],
  scoring: { result: 100 },
};

async function runGit(repository: string, args: string[]): Promise<string> {
  const result = await createProcessRunner().run({
    executable: "git",
    args,
    cwd: repository,
  });
  if (result.kind !== "completed" || result.exitCode !== 0)
    throw new Error(result.stderr);
  return result.stdout.trim();
}

async function directoryFingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (path: string, prefix = ""): Promise<void> => {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      hash.update(relativePath);
      if (entry.isDirectory())
        await visit(join(path, entry.name), relativePath);
      else hash.update(await readFile(join(path, entry.name)));
    }
  };
  await visit(root);
  return hash.digest("hex");
}

describe("generateWorkspace", () => {
  it("generates deterministic non-linear history in paths containing spaces", async () => {
    await withTemporaryDirectory(async (parent) => {
      const sourceBefore = await directoryFingerprint(fixture);
      const first = await generateWorkspace({
        scenario,
        fixture,
        destination: join(parent, "repo one"),
        generatorVersion: "0.1.0",
      });
      const second = await generateWorkspace({
        scenario,
        fixture,
        destination: join(parent, "repo two"),
        generatorVersion: "0.1.0",
      });
      const ambientTemplate = join(parent, "ambient-template");
      await mkdir(join(ambientTemplate, "hooks"), { recursive: true });
      await writeFile(
        join(ambientTemplate, "hooks", "pre-commit"),
        "#!/bin/sh\nexit 1\n",
      );
      await writeFile(join(ambientTemplate, "ambient-marker"), "must not copy");
      const previousTemplate = process.env.GIT_TEMPLATE_DIR;
      process.env.GIT_TEMPLATE_DIR = ambientTemplate;
      const isolatedDestination = join(parent, "repo ambient");
      try {
        await generateWorkspace({
          scenario,
          fixture,
          destination: isolatedDestination,
          generatorVersion: "0.1.0",
        });
      } finally {
        if (previousTemplate === undefined) delete process.env.GIT_TEMPLATE_DIR;
        else process.env.GIT_TEMPLATE_DIR = previousTemplate;
      }
      expect(first.commits).toEqual(second.commits);
      expect(first.refs).toEqual(second.refs);
      expect(await runGit(first.destination, ["status", "--porcelain"])).toBe(
        "",
      );
      expect(await runGit(first.destination, ["rev-parse", "main"])).toBe(
        first.commits["semantic-a"],
      );
      expect(
        await runGit(first.destination, ["rev-list", "--count", "--all"]),
      ).toBe("4");
      const authoredIds = new Set(Object.values(first.commits));
      expect(
        (await runGit(first.destination, ["rev-list", "main"]))
          .split("\n")
          .filter((id) => authoredIds.has(id)),
      ).toEqual([first.commits["semantic-a"]]);
      for (const id of Object.keys(first.commits)) {
        expect(
          await runGit(first.destination, [
            "show",
            "-s",
            "--format=%T",
            first.commits[id] ?? "",
          ]),
        ).toBe(
          await runGit(second.destination, [
            "show",
            "-s",
            "--format=%T",
            second.commits[id] ?? "",
          ]),
        );
        expect(
          await runGit(first.destination, [
            "show",
            "-s",
            "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI",
            first.commits[id] ?? "",
          ]),
        ).toBe(
          await runGit(second.destination, [
            "show",
            "-s",
            "--format=%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI",
            second.commits[id] ?? "",
          ]),
        );
      }
      expect(
        await runGit(first.destination, [
          "show",
          `${first.commits["semantic-a"] ?? ""}:app.mjs`,
        ]),
      ).toBe(
        (
          await readFile(
            join(fixture, "changes", "semantic-a", "app.mjs"),
            "utf8",
          )
        ).trim(),
      );
      expect(
        await runGit(first.destination, [
          "show",
          "-s",
          "--format=%s",
          first.commits["semantic-resolution"] ?? "",
        ]),
      ).toBe("Resolve");
      expect(
        (
          await runGit(first.destination, [
            "show",
            "-s",
            "--format=%P",
            first.commits["semantic-resolution"] ?? "",
          ])
        ).split(" "),
      ).toEqual([first.commits["semantic-a"], first.commits["semantic-b"]]);
      expect(await runGit(first.destination, ["remote"])).toBe("");
      expect(
        await readdir(join(first.destination, ".git", "hooks")).catch(() => []),
      ).toEqual([]);
      expect(
        await readdir(join(isolatedDestination, ".git", "hooks")).catch(
          () => [],
        ),
      ).toEqual([]);
      await expect(
        readFile(join(isolatedDestination, ".git", "ambient-marker")),
      ).rejects.toBeDefined();
      expect(
        await runGit(first.destination, [
          "config",
          "--local",
          "commit.gpgSign",
        ]),
      ).toBe("false");
      const authoredName = await runGit(first.destination, [
        "show",
        "-s",
        "--format=%an",
        first.commits["semantic-a"] ?? "",
      ]);
      const authoredEmail = await runGit(first.destination, [
        "show",
        "-s",
        "--format=%ae",
        first.commits["semantic-a"] ?? "",
      ]);
      expect(
        await runGit(first.destination, ["config", "--local", "user.name"]),
      ).toBe(authoredName);
      expect(
        await runGit(first.destination, ["config", "--local", "user.email"]),
      ).toBe(authoredEmail);
      expect(
        await runGit(first.destination, [
          "rev-parse",
          "refs/releasemango/baselines/acceptance",
        ]),
      ).toBe(first.commits["semantic-a"]);
      expect(
        await runGit(first.destination, [
          "rev-parse",
          "refs/releasemango/baselines/production",
        ]),
      ).toBe(first.commits["semantic-resolution"]);
      expect(
        await runGit(first.destination, [
          "rev-parse",
          "refs/releasemango/commits/semantic-b",
        ]),
      ).toBe(first.commits["semantic-b"]);
      const storedManifest: unknown = JSON.parse(
        await readFile(
          join(first.destination, OWNERSHIP_MANIFEST_PATH),
          "utf8",
        ),
      );
      expect(storedManifest).toEqual(first.manifest);
      expect(storedManifest).toMatchObject({
        schemaVersion: 2,
        scenarioId: "non-linear",
        workspaceInitialMain: "semantic-a",
        judgingBundle: {
          identity: "tiny-node-api",
          integrity: first.manifest.fixtureIdentity,
        },
        generatedRefs: first.refs,
      });
      expect(
        await runGit(first.destination, ["ls-files", OWNERSHIP_MANIFEST_PATH]),
      ).toBe("");
      expect(
        await runGit(first.destination, ["ls-files", "judging/check.mjs"]),
      ).toBe("");
      expect(await directoryFingerprint(fixture)).toBe(sourceBefore);
    });
  }, 15_000);

  it("reports injected phases and leaves no first-generation destination", async () => {
    await withTemporaryDirectory(async (parent) => {
      const destination = join(parent, "failed");
      await expect(
        generateWorkspace({
          scenario,
          fixture,
          destination,
          generatorVersion: "0.1.0",
          failAt: "history",
        }),
      ).rejects.toMatchObject<Partial<GenerationError>>({ phase: "history" });
      await expect(readFile(destination)).rejects.toBeDefined();
    });
  });

  it("rejects incomplete ownership without changing any destination entry", async () => {
    await withTemporaryDirectory(async (parent) => {
      const destination = join(parent, "owned");
      await generateWorkspace({
        scenario,
        fixture,
        destination,
        generatorVersion: "0.1.0",
      });
      const marker = join(destination, OWNERSHIP_MANIFEST_PATH);
      const ownership = JSON.parse(await readFile(marker, "utf8")) as Record<
        string,
        unknown
      >;
      ownership.generatedRefs = {};
      await writeFile(marker, JSON.stringify(ownership));
      await writeFile(join(destination, "sentinel"), "preserve");
      const before = (await readdir(destination)).sort();

      await expect(
        generateWorkspace({
          scenario,
          fixture,
          destination,
          generatorVersion: "0.1.0",
          overwrite: true,
        }),
      ).rejects.toMatchObject({ phase: "validation" });
      expect((await readdir(destination)).sort()).toEqual(before);
      expect(await readFile(join(destination, "sentinel"), "utf8")).toBe(
        "preserve",
      );
    });
  });

  it("derives history from seed, scenario ID, and generator version", async () => {
    await withTemporaryDirectory(async (parent) => {
      const generate = (
        name: string,
        changedScenario: ScenarioDefinition,
        generatorVersion: string,
        seed: number,
      ) =>
        generateWorkspace({
          scenario: changedScenario,
          fixture,
          destination: join(parent, name),
          generatorVersion,
          seed,
        });
      const original = await generate("original", scenario, "0.1.0", 17);
      const farSeed = await generate("far seed", scenario, "0.1.0", 100_017);
      const renamed = await generate(
        "renamed",
        { ...scenario, metadata: { ...scenario.metadata, id: "other" } },
        "0.1.0",
        17,
      );
      const versioned = await generate("versioned", scenario, "0.2.0", 17);
      expect(farSeed.commits).not.toEqual(original.commits);
      expect(renamed.commits).not.toEqual(original.commits);
      expect(versioned.commits).not.toEqual(original.commits);
    });
  }, 15_000);

  it("refuses a destination in the authoritative checkout", async () => {
    const destination = await mkdtemp(join(checkout, ".tea-8-containment-"));
    await rm(destination, { recursive: true });
    try {
      await expect(
        generateWorkspace({
          scenario,
          fixture,
          destination,
          generatorVersion: "0.1.0",
        }),
      ).rejects.toMatchObject({ phase: "validation" });
      await expect(readdir(destination)).rejects.toBeDefined();
    } finally {
      await rm(destination, { recursive: true, force: true });
    }
  });

  it("canonicalizes a symlinked parent before checkout containment validation", async () => {
    await withTemporaryDirectory(async (parent) => {
      const checkoutTarget = await mkdtemp(join(checkout, ".tea-8-symlink-"));
      const linkedParent = join(parent, "linked checkout");
      await symlink(checkoutTarget, linkedParent);
      try {
        await expect(
          generateWorkspace({
            scenario,
            fixture,
            destination: join(linkedParent, "generated"),
            generatorVersion: "0.1.0",
          }),
        ).rejects.toMatchObject({ phase: "validation" });
        expect(await readdir(checkoutTarget)).toEqual([]);
      } finally {
        await rm(checkoutTarget, { recursive: true, force: true });
      }
    });
  });

  it("rejects fixture mismatch before destination mutation and preserves sources", async () => {
    await withTemporaryDirectory(async (parent) => {
      const fixtureCopy = join(parent, "fixture");
      await cp(fixture, fixtureCopy, { recursive: true });
      const manifestPath = join(fixtureCopy, "states.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
        units: Record<string, { requires: string[]; files: string[] }>;
      };
      const unit = manifest.units["semantic-resolution"];
      if (unit) unit.requires = ["semantic-a"];
      await writeFile(manifestPath, JSON.stringify(manifest));
      const sourceBefore = await readFile(manifestPath, "utf8");
      const destination = join(parent, "must-not-exist");

      await expect(
        generateWorkspace({
          scenario,
          fixture: fixtureCopy,
          destination,
          generatorVersion: "0.1.0",
        }),
      ).rejects.toMatchObject({ phase: "validation" });
      await expect(readdir(destination)).rejects.toBeDefined();
      expect(await readFile(manifestPath, "utf8")).toBe(sourceBefore);
    });
  });

  it("cleans staging for an injected failure in every generation phase", async () => {
    await withTemporaryDirectory(async (parent) => {
      const sourceBefore = await directoryFingerprint(fixture);
      for (const phase of [
        "validation",
        "staging",
        "copy",
        "git-initialization",
        "history",
        "refs",
        "manifest",
        "publish",
      ] as const) {
        const destination = join(parent, phase);
        await expect(
          generateWorkspace({
            scenario,
            fixture,
            destination,
            generatorVersion: "0.1.0",
            failAt: phase,
          }),
        ).rejects.toMatchObject({ phase });
        await expect(readdir(destination)).rejects.toBeDefined();
        expect(
          (await readdir(parent)).filter((entry) =>
            entry.startsWith(`.${phase}.staging-`),
          ),
        ).toEqual([]);
        expect(await directoryFingerprint(fixture)).toBe(sourceBefore);
      }
    });
  });

  it("overwrites only a matching, repository-consistent owned workspace", async () => {
    await withTemporaryDirectory(async (parent) => {
      const sourceBefore = await directoryFingerprint(fixture);
      const destination = join(parent, "replace");
      const first = await generateWorkspace({
        scenario,
        fixture,
        destination,
        generatorVersion: "0.1.0",
      });
      await writeFile(join(destination, "player-note"), "disposable");
      const replacement = await generateWorkspace({
        scenario,
        fixture,
        destination,
        generatorVersion: "0.1.0",
        overwrite: true,
      });
      expect(replacement.commits).toEqual(first.commits);
      expect(await directoryFingerprint(fixture)).toBe(sourceBefore);
      await expect(
        readFile(join(destination, "player-note")),
      ).rejects.toBeDefined();

      await writeFile(
        join(destination, ".git", "refs", "heads", "main"),
        "0000000000000000000000000000000000000000\n",
      );
      await expect(
        generateWorkspace({
          scenario,
          fixture,
          destination,
          generatorVersion: "0.1.0",
          overwrite: true,
        }),
      ).rejects.toMatchObject({ phase: "validation" });
    });
  });

  it("restores an owned repository when publication fails after backup", async () => {
    await withTemporaryDirectory(async (parent) => {
      const sourceBefore = await directoryFingerprint(fixture);
      const destination = join(parent, "rollback");
      const original = await generateWorkspace({
        scenario,
        fixture,
        destination,
        generatorVersion: "0.1.0",
      });
      const originalHead = await runGit(destination, ["rev-parse", "HEAD"]);
      const originalMarker = await readFile(
        join(destination, OWNERSHIP_MANIFEST_PATH),
        "utf8",
      );
      await expect(
        generateWorkspace({
          scenario,
          fixture,
          destination,
          generatorVersion: "0.1.0",
          overwrite: true,
          failPublishAfterBackup: true,
        }),
      ).rejects.toMatchObject({ phase: "publish" });
      expect(await runGit(destination, ["rev-parse", "HEAD"])).toBe(
        originalHead,
      );
      expect(await runGit(destination, ["status", "--porcelain"])).toBe("");
      expect(
        await readFile(join(destination, OWNERSHIP_MANIFEST_PATH), "utf8"),
      ).toBe(originalMarker);
      expect(await runGit(destination, ["rev-parse", "HEAD"])).toBe(
        original.commits["semantic-a"],
      );
      expect(
        (await readdir(parent)).filter(
          (entry) => entry.includes(".staging-") || entry.includes(".backup-"),
        ),
      ).toEqual([]);
      expect(await directoryFingerprint(fixture)).toBe(sourceBefore);
    });
  });
});
