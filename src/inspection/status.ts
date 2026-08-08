import { readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import {
  createGitAdapter,
  type GitAdapter,
  type StatusEntry,
} from "../git/index.js";
import {
  OWNERSHIP_MANIFEST_PATH,
  type OwnershipManifest,
} from "../generator/index.js";
import {
  deepFreeze,
  type InspectionResult,
  type TargetAvailability,
  type WorkspaceStatus,
} from "./model.js";

export interface StatusInspectionOptions {
  readonly git?: GitAdapter;
  readonly readText?: (path: string) => Promise<string>;
}
const branchRefs = {
  main: "refs/heads/main",
  acceptance: "refs/heads/release/acceptance",
  production: "refs/heads/release/production",
} as const;
const baselineRefs = {
  acceptance: "refs/releasemango/baselines/acceptance",
  production: "refs/releasemango/baselines/production",
} as const;
const failure = (code: string, message: string): InspectionResult<never> =>
  deepFreeze({ ok: false, diagnostics: [{ code, message }] });
const unavailable = (code: string, message: string): TargetAvailability => ({
  available: false,
  reason: { code, message },
});

function manifestShape(value: unknown): value is OwnershipManifest {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const item = value as Record<string, unknown>;
  const judging = item.judgingBundle as Record<string, unknown> | undefined;
  return (
    item.schemaVersion === 2 &&
    typeof item.scenarioId === "string" &&
    typeof item.seed === "number" &&
    Number.isSafeInteger(item.seed) &&
    typeof item.generatorVersion === "string" &&
    typeof item.fixture === "string" &&
    typeof item.fixtureIdentity === "string" &&
    typeof item.workspaceInitialMain === "string" &&
    judging !== undefined &&
    typeof judging.identity === "string" &&
    typeof judging.integrity === "string" &&
    item.generatedRefs !== null &&
    typeof item.generatedRefs === "object" &&
    !Array.isArray(item.generatedRefs)
  );
}
function conflicted(entries: readonly StatusEntry[]): boolean {
  return entries.some(
    ({ index, worktree }) =>
      index === "U" ||
      worktree === "U" ||
      (index === "A" && worktree === "A") ||
      (index === "D" && worktree === "D"),
  );
}

export async function inspectStatus(
  workspace: string,
  options: StatusInspectionOptions = {},
): Promise<InspectionResult<WorkspaceStatus>> {
  const readText =
    options.readText ?? ((path: string) => readFile(path, "utf8"));
  let text: string;
  try {
    text = await readText(join(workspace, OWNERSHIP_MANIFEST_PATH));
  } catch {
    return failure(
      "OWNERSHIP_MANIFEST_MISSING",
      `No ownership manifest was found in '${workspace}'.`,
    );
  }
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return failure(
      "OWNERSHIP_MANIFEST_MALFORMED",
      "The ownership manifest is not valid JSON.",
    );
  }
  const version = (input as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (version !== 2)
    return failure(
      "OWNERSHIP_MANIFEST_VERSION_UNSUPPORTED",
      `Ownership manifest schema version ${String(version)} is unsupported.`,
    );
  if (!manifestShape(input))
    return failure(
      "OWNERSHIP_MANIFEST_INVALID",
      "The ownership manifest does not have the required version 2 structure.",
    );
  const manifest = input;
  const generated = manifest.generatedRefs;
  for (const [name, id] of Object.entries(generated))
    if (!/^[0-9a-f]{40}$/u.test(id))
      return failure(
        "OWNERSHIP_REF_INVALID",
        `Ownership ref '${name}' has an invalid object ID.`,
      );

  const git = options.git ?? createGitAdapter(workspace);
  const refs = await git.listRefs();
  if (!refs.ok)
    return failure(
      "GIT_INSPECTION_FAILED",
      `Git operation '${refs.operation}' failed while inspecting the workspace.`,
    );
  const byName = new Map(refs.entries.map(({ name, id }) => [name, id]));
  const targetRefs = new Set<string>([
    ...Object.values(branchRefs),
    ...Object.values(baselineRefs),
  ]);
  for (const [name, id] of Object.entries(generated)) {
    if (targetRefs.has(name)) continue;
    if (byName.get(name) !== id)
      return failure(
        "OWNERSHIP_REF_INCONSISTENT",
        `Ownership ref '${name}' does not match the repository.`,
      );
  }
  const status = await git.status();
  if (!status.ok)
    return failure(
      "GIT_INSPECTION_FAILED",
      `Git operation '${status.operation}' failed while inspecting the workspace.`,
    );
  const worktrees = await git.listWorktrees();
  if (!worktrees.ok)
    return failure(
      "GIT_INSPECTION_FAILED",
      `Git operation '${worktrees.operation}' failed while inspecting the workspace.`,
    );
  let canonical = workspace;
  try {
    canonical = await realpath(workspace);
  } catch {
    /* Git result below remains actionable. */
  }
  const current =
    worktrees.entries.find((entry) => entry.path === canonical) ??
    worktrees.entries[0];
  if (!current)
    return failure(
      "GIT_INSPECTION_FAILED",
      "Git did not report a worktree for the workspace.",
    );
  const branches = {
    main: byName.has(branchRefs.main),
    acceptance: byName.has(branchRefs.acceptance),
    production: byName.has(branchRefs.production),
  };
  const sharedValid =
    manifest.judgingBundle.identity !== "" &&
    manifest.judgingBundle.integrity !== "";
  const availability = (
    target: "acceptance" | "production",
  ): TargetAvailability => {
    if (!sharedValid)
      return unavailable(
        "JUDGING_METADATA_INVALID",
        "Shared judging metadata is missing or invalid.",
      );
    if (!branches[target])
      return unavailable(
        "TARGET_BRANCH_MISSING",
        `Branch 'release/${target}' is missing.`,
      );
    const name = baselineRefs[target];
    const expected = generated[name];
    if (expected === undefined || byName.get(name) === undefined)
      return unavailable(
        "TARGET_BASELINE_MISSING",
        `Baseline ref '${name}' is missing.`,
      );
    if (byName.get(name) !== expected)
      return unavailable(
        "TARGET_BASELINE_INCONSISTENT",
        `Baseline ref '${name}' does not match the ownership manifest.`,
      );
    return { available: true };
  };
  const branch = current.branch?.replace(/^refs\/heads\//u, "");
  return deepFreeze({
    ok: true,
    value: {
      head:
        current.detached || branch === undefined
          ? { kind: "detached" }
          : { kind: "branch", name: branch },
      branches,
      worktree: conflicted(status.entries)
        ? "conflicted"
        : status.entries.length > 0
          ? "dirty"
          : "clean",
      evaluation: {
        acceptance: availability("acceptance"),
        production: availability("production"),
      },
    },
  });
}
