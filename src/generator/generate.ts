import { createHash } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { execa } from "execa";
import { fileURLToPath } from "node:url";
import type { ScenarioCommit } from "../domain/scenarios/index.js";
import { fingerprintAssetBundle } from "./fingerprint.js";
import {
  GenerationError,
  OWNERSHIP_MANIFEST_PATH,
  type FixtureManifest,
  type GenerationPhase,
  type GenerationRequest,
  type GenerationResult,
  type OwnershipManifest,
} from "./model.js";

const SOURCE_CHECKOUT = resolve(
  fileURLToPath(new URL("../../", import.meta.url)),
);

const refName = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!normalized || normalized.includes("..") || normalized.endsWith(".lock"))
    throw new Error(`Unsafe generated ref component '${value}'.`);
  return normalized;
};

const inside = (parent: string, candidate: string): boolean => {
  const path = relative(parent, candidate);
  return (
    path === "" ||
    (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path))
  );
};

const safeAsset = (root: string, name: string): string => {
  if (isAbsolute(name) || name.includes("\\") || name.includes("\0"))
    throw new Error(`Unsafe fixture asset '${name}'.`);
  const target = resolve(root, name);
  if (!inside(root, target) || target === root)
    throw new Error(`Unsafe fixture asset '${name}'.`);
  return target;
};

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function canonicalTarget(path: string): Promise<string> {
  let ancestor = path;
  while (!(await exists(ancestor))) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const canonicalAncestor = await realpath(ancestor);
  return resolve(canonicalAncestor, relative(ancestor, path));
}

const identityFields = (manifest: OwnershipManifest) => ({
  schemaVersion: manifest.schemaVersion,
  scenarioId: manifest.scenarioId,
  seed: manifest.seed,
  generatorVersion: manifest.generatorVersion,
  fixtureIdentity: manifest.fixtureIdentity,
  judgingBundle: manifest.judgingBundle,
  workspaceInitialMain: manifest.workspaceInitialMain,
});

const sameIdentity = (
  left: OwnershipManifest,
  right: OwnershipManifest,
): boolean =>
  JSON.stringify(identityFields(left)) ===
  JSON.stringify(identityFields(right));

function expectedRefNames(request: GenerationRequest): Set<string> {
  return new Set([
    "refs/heads/main",
    "refs/releasemango/baselines/acceptance",
    "refs/releasemango/baselines/production",
    "refs/releasemango/fixture/baseline",
    ...request.scenario.commits.flatMap((commit) => [
      `refs/releasemango/commits/${refName(commit.id)}`,
      `refs/heads/tickets/${refName(commit.ticket)}`,
    ]),
  ]);
}

async function validateOwnedDestination(
  destination: string,
  input: unknown,
  intended: OwnershipManifest,
  request: GenerationRequest,
): Promise<void> {
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new Error("Ownership manifest must be an object.");
  const value = input as Record<string, unknown>;
  for (const field of [
    "scenarioId",
    "generatorVersion",
    "fixture",
    "fixtureIdentity",
    "workspaceInitialMain",
  ])
    if (typeof value[field] !== "string" || value[field] === "")
      throw new Error(`Ownership manifest field '${field}' is invalid.`);
  if (
    value.schemaVersion !== 2 ||
    value.judgingBundle === null ||
    typeof value.judgingBundle !== "object" ||
    typeof (value.judgingBundle as Record<string, unknown>).identity !==
      "string" ||
    typeof (value.judgingBundle as Record<string, unknown>).integrity !==
      "string" ||
    typeof value.seed !== "number" ||
    !Number.isSafeInteger(value.seed) ||
    value.generatedRefs === null ||
    typeof value.generatedRefs !== "object" ||
    Array.isArray(value.generatedRefs)
  )
    throw new Error("Ownership manifest shape is invalid.");
  const manifest = value as unknown as OwnershipManifest;
  if (!sameIdentity(manifest, intended))
    throw new Error("Destination ownership identity does not match.");
  const refs = manifest.generatedRefs;
  const expected = [...expectedRefNames(request)].sort();
  const actual = Object.keys(refs).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error("Ownership manifest generated refs are incomplete.");
  for (const [ref, id] of Object.entries(refs)) {
    if (!/^[0-9a-f]{40}$/u.test(id))
      throw new Error(`Ownership ref '${ref}' has an invalid object ID.`);
    const resolved = await git(destination, ["rev-parse", "--verify", ref]);
    if (resolved !== id)
      throw new Error(`Ownership ref '${ref}' does not match the repository.`);
  }
}

async function git(
  repository: string,
  args: readonly string[],
  environment: Readonly<Record<string, string>> = {},
): Promise<string> {
  const result = await execa("git", [...args], {
    cwd: repository,
    extendEnv: false,
    env: {
      PATH: process.env.PATH ?? "",
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_GLOBAL: join(repository, ".git", "releasemango-no-global"),
      GIT_CONFIG_SYSTEM: join(repository, ".git", "releasemango-no-system"),
      ...environment,
    },
  });
  return result.stdout.trim();
}

async function clearPlayerTree(repository: string): Promise<void> {
  for (const entry of await readdir(repository)) {
    if (entry !== ".git")
      await rm(join(repository, entry), { recursive: true, force: true });
  }
}

function orderedAncestors(
  commit: ScenarioCommit,
  byId: ReadonlyMap<string, ScenarioCommit>,
  authored: readonly ScenarioCommit[],
): ScenarioCommit[] {
  const wanted = new Set<string>();
  const visit = (id: string): void => {
    if (wanted.has(id)) return;
    const current = byId.get(id);
    if (!current) return;
    for (const dependency of current.dependsOn) visit(dependency);
    wanted.add(id);
  };
  visit(commit.id);
  return authored.filter(({ id }) => wanted.has(id));
}

async function copyUnit(
  fixture: string,
  repository: string,
  manifest: FixtureManifest,
  unitId: string,
): Promise<void> {
  const unit = manifest.units[unitId];
  if (!unit) throw new Error(`Missing fixture change unit '${unitId}'.`);
  const unitRoot = safeAsset(join(fixture, "changes"), unitId);
  for (const file of unit.files) {
    const source = safeAsset(unitRoot, file);
    const destination = safeAsset(repository, file);
    const sourceInfo = await lstat(source);
    if (!sourceInfo.isFile())
      throw new Error(`Fixture asset is not a file: ${unitId}/${file}`);
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination);
  }
}

const phase = (request: GenerationRequest, value: GenerationPhase): void => {
  if (request.failAt === value)
    throw new GenerationError(value, `Injected ${value} failure.`);
};

async function validate(request: GenerationRequest): Promise<{
  fixture: string;
  manifest: FixtureManifest;
  fixtureIdentity: string;
  seed: number;
}> {
  phase(request, "validation");
  const destination = resolve(request.destination);
  const sourceCheckout = await realpath(SOURCE_CHECKOUT);
  const destinationExists = await exists(destination);
  if (
    inside(sourceCheckout, destination) ||
    inside(sourceCheckout, await canonicalTarget(destination))
  )
    throw new Error("Destination must be outside the source checkout.");
  if (destinationExists && (await lstat(destination)).isSymbolicLink())
    throw new Error("Destination must not be a symbolic link.");
  const fixture = await realpath(request.fixture);
  const seed = request.seed ?? request.scenario.seed;
  if (!Number.isSafeInteger(seed) || seed < 0)
    throw new Error("Generation seed must be a non-negative safe integer.");
  const manifest = JSON.parse(
    await readFile(join(fixture, "states.json"), "utf8"),
  ) as FixtureManifest;
  if (manifest.version !== 1 || typeof manifest.units !== "object")
    throw new Error("Unsupported fixture manifest.");
  const commitIds = new Set(request.scenario.commits.map(({ id }) => id));
  for (const commit of request.scenario.commits) {
    const unit = manifest.units[commit.id];
    if (!unit) throw new Error(`Missing fixture change unit '${commit.id}'.`);
    if (
      unit.requires.length !== commit.dependsOn.length ||
      unit.requires.some((id, index) => id !== commit.dependsOn[index])
    )
      throw new Error(
        `Fixture dependencies do not match commit '${commit.id}'.`,
      );
    for (const dependency of unit.requires)
      if (!commitIds.has(dependency))
        throw new Error(
          `Fixture unit '${commit.id}' requires unknown '${dependency}'.`,
        );
    for (const file of unit.files) {
      const unitRoot = safeAsset(join(fixture, "changes"), commit.id);
      const source = safeAsset(unitRoot, file);
      if (!(await exists(source)))
        throw new Error(`Missing fixture asset '${commit.id}/${file}'.`);
    }
  }
  const baseline = join(fixture, "baseline");
  if (!(await stat(baseline)).isDirectory())
    throw new Error("Fixture baseline is missing.");
  return {
    fixture,
    manifest,
    fixtureIdentity: await fingerprintAssetBundle(fixture),
    seed,
  };
}

export async function generateWorkspace(
  request: GenerationRequest,
): Promise<GenerationResult> {
  let staging: string | undefined;
  let backup: string | undefined;
  let activePhase: GenerationPhase = "validation";
  const enter = (value: GenerationPhase): void => {
    activePhase = value;
    phase(request, value);
  };
  const destination = resolve(request.destination);
  try {
    const validated = await validate(request).catch((error: unknown) => {
      if (error instanceof GenerationError) throw error;
      throw new GenerationError(
        "validation",
        "Generation validation failed.",
        error,
      );
    });
    const intended: OwnershipManifest = {
      schemaVersion: 2,
      scenarioId: request.scenario.metadata.id,
      seed: validated.seed,
      generatorVersion: request.generatorVersion,
      fixture: basename(validated.fixture),
      fixtureIdentity: validated.fixtureIdentity,
      judgingBundle: {
        identity: basename(validated.fixture),
        integrity: validated.fixtureIdentity,
      },
      workspaceInitialMain: request.scenario.workspace.initialMain,
      generatedRefs: {},
    };
    if (await exists(destination)) {
      const entries = await readdir(destination);
      if (entries.length > 0) {
        if (!request.overwrite)
          throw new GenerationError(
            "validation",
            "Destination is non-empty and overwrite is false.",
          );
        let owned: unknown;
        try {
          owned = JSON.parse(
            await readFile(join(destination, OWNERSHIP_MANIFEST_PATH), "utf8"),
          );
        } catch (error) {
          throw new GenerationError(
            "validation",
            "Destination has no valid ownership manifest.",
            error,
          );
        }
        try {
          await validateOwnedDestination(destination, owned, intended, request);
        } catch (error) {
          throw new GenerationError(
            "validation",
            "Destination ownership state is invalid.",
            error,
          );
        }
      }
    }

    enter("staging");
    await mkdir(dirname(destination), { recursive: true });
    staging = await mkdtemp(
      join(dirname(destination), `.${basename(destination)}.staging-`),
    );
    enter("copy");
    await cp(join(validated.fixture, "baseline"), staging, { recursive: true });

    const metadataKey = createHash("sha256")
      .update(request.generatorVersion)
      .update("\0")
      .update(request.scenario.metadata.id)
      .update("\0")
      .update(String(validated.seed))
      .digest("hex");
    const identityName = `Release Mango ${metadataKey.slice(0, 12)}`;
    const identityEmail = `generator+${metadataKey}@releasemango.invalid`;
    const identity = {
      GIT_AUTHOR_NAME: identityName,
      GIT_AUTHOR_EMAIL: identityEmail,
      GIT_COMMITTER_NAME: identityName,
      GIT_COMMITTER_EMAIL: identityEmail,
    };
    const seconds =
      946_684_800 + Number(BigInt(`0x${metadataKey}`) % 2_000_000_000n);
    const dated = (index: number) => {
      const date = `${String(seconds + index * 60)} +0000`;
      return { ...identity, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date };
    };

    enter("git-initialization");
    await git(staging, ["init", "--initial-branch=main", "--template="]);
    await git(staging, ["config", "--local", "user.name", identityName]);
    await git(staging, ["config", "--local", "user.email", identityEmail]);
    await git(staging, ["config", "--local", "commit.gpgSign", "false"]);
    await git(staging, ["config", "--local", "tag.gpgSign", "false"]);

    enter("history");
    await git(staging, ["add", "-A"]);
    const baselineTree = await git(staging, ["write-tree"]);
    const baselineCommit = await git(
      staging,
      ["commit-tree", baselineTree, "-m", "Release Mango fixture baseline"],
      dated(0),
    );
    const commits: Record<string, string> = {};
    const generatedCommit = (id: string): string => {
      const value = commits[id];
      if (value === undefined)
        throw new Error(`Authored commit '${id}' has not been generated.`);
      return value;
    };
    const byId = new Map(
      request.scenario.commits.map((commit) => [commit.id, commit]),
    );
    const remaining = [...request.scenario.commits];
    let commitIndex = 0;
    while (remaining.length > 0) {
      const readyIndex = remaining.findIndex((commit) =>
        commit.dependsOn.every(
          (dependency) => commits[dependency] !== undefined,
        ),
      );
      if (readyIndex < 0)
        throw new Error("Scenario commit dependencies are not acyclic.");
      const [commit] = remaining.splice(readyIndex, 1);
      if (!commit)
        throw new Error("Unable to select the next authored commit.");
      await clearPlayerTree(staging);
      await cp(join(validated.fixture, "baseline"), staging, {
        recursive: true,
      });
      for (const unit of orderedAncestors(
        commit,
        byId,
        request.scenario.commits,
      ))
        await copyUnit(validated.fixture, staging, validated.manifest, unit.id);
      await git(staging, ["add", "-A"]);
      const tree = await git(staging, ["write-tree"]);
      const parents = commit.dependsOn.length
        ? commit.dependsOn.map(generatedCommit)
        : [baselineCommit];
      commits[commit.id] = await git(
        staging,
        [
          "commit-tree",
          tree,
          ...parents.flatMap((id) => ["-p", id]),
          "-m",
          commit.message,
        ],
        dated(commitIndex + 1),
      );
      commitIndex += 1;
    }

    enter("refs");
    const refs: Record<string, string> = {
      "refs/heads/main": generatedCommit(
        request.scenario.workspace.initialMain,
      ),
      "refs/releasemango/baselines/acceptance": generatedCommit(
        request.scenario.releases.acceptance.baseline,
      ),
      "refs/releasemango/baselines/production": generatedCommit(
        request.scenario.releases.production.baseline,
      ),
      "refs/releasemango/fixture/baseline": baselineCommit,
    };
    for (const commit of request.scenario.commits) {
      const id = generatedCommit(commit.id);
      refs[`refs/releasemango/commits/${refName(commit.id)}`] = id;
      refs[`refs/heads/tickets/${refName(commit.ticket)}`] = id;
    }
    for (const [ref, id] of Object.entries(refs))
      await git(staging, ["update-ref", ref, id]);
    await writeFile(join(staging, ".git", "HEAD"), "ref: refs/heads/main\n");
    await git(staging, [
      "reset",
      "--hard",
      refs["refs/heads/main"] ??
        generatedCommit(request.scenario.workspace.initialMain),
    ]);

    enter("manifest");
    const ownership: OwnershipManifest = { ...intended, generatedRefs: refs };
    await mkdir(dirname(join(staging, OWNERSHIP_MANIFEST_PATH)), {
      recursive: true,
    });
    await writeFile(
      join(staging, OWNERSHIP_MANIFEST_PATH),
      `${JSON.stringify(ownership, null, 2)}\n`,
      { mode: 0o600 },
    );

    enter("publish");
    if (await exists(destination)) {
      const entries = await readdir(destination);
      if (entries.length === 0) await rm(destination, { recursive: true });
      else {
        backup = `${destination}.backup-${process.pid.toString()}`;
        await rename(destination, backup);
      }
    }
    try {
      if (request.failPublishAfterBackup)
        throw new Error("Injected publication failure after backup.");
      await rename(staging, destination);
      staging = undefined;
    } catch (error) {
      if (backup && !(await exists(destination)))
        await rename(backup, destination);
      throw error;
    }
    if (backup) {
      await rm(backup, { recursive: true, force: true });
      backup = undefined;
    }
    return Object.freeze({
      destination,
      commits: Object.freeze({ ...commits }),
      refs: Object.freeze({ ...refs }),
      manifest: Object.freeze(ownership),
    });
  } catch (error: unknown) {
    if (error instanceof GenerationError) throw error;
    throw new GenerationError(
      activePhase,
      `Generation failed during ${activePhase}.`,
      error,
    );
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
    if (backup && !(await exists(destination)))
      await rename(backup, destination);
  }
}
