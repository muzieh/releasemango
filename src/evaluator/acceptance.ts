import { createHash } from "node:crypto";
import { access, readFile, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  OWNERSHIP_MANIFEST_PATH,
  type OwnershipManifest,
} from "../generator/index.js";
import type {
  BehaviorCheck,
  ScenarioDefinition,
} from "../domain/scenarios/index.js";
import { evaluateBranch } from "./evaluate.js";
import type {
  AcceptanceEvaluationRequest,
  AcceptanceEvaluationResult,
  EvaluationCheckResult,
  EvaluationResult,
} from "./model.js";

export const ACCEPTANCE_BRANCH = "release/acceptance";
export const ACCEPTANCE_BASELINE = "refs/releasemango/baselines/acceptance";

const freezeResult = (
  check: EvaluationCheckResult,
): AcceptanceEvaluationResult =>
  Object.freeze({
    status: "error",
    termination: "completed",
    durationMs: 0,
    checks: Object.freeze([Object.freeze(check)]),
    branch: ACCEPTANCE_BRANCH,
    baseline: ACCEPTANCE_BASELINE,
    tickets: Object.freeze([]),
    requiredChecks: Object.freeze([]),
    forbiddenChecks: Object.freeze([]),
  });

const assetFailure = (summary: string): AcceptanceEvaluationResult =>
  freezeResult({
    id: "infrastructure.judging-assets",
    category: "infrastructure",
    status: "error",
    durationMs: 0,
    evidence: Object.freeze({ stdout: "", stderr: "", summary }),
    remediation:
      "Restore the trusted judging bundle and regenerate the workspace.",
  });

async function fingerprint(root: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (path: string, prefix = ""): Promise<void> => {
    for (const entry of (await readdir(path, { withFileTypes: true })).sort(
      (left, right) => left.name.localeCompare(right.name),
    )) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      hash.update(name);
      if (entry.isSymbolicLink())
        throw new Error(`Symlink is not allowed: ${name}`);
      if (entry.isDirectory()) await visit(join(path, entry.name), name);
      else hash.update(await readFile(join(path, entry.name)));
    }
  };
  await visit(root);
  return hash.digest("hex");
}

const inside = (root: string, path: string): boolean => {
  const name = relative(root, path);
  return (
    name === "" ||
    (!name.startsWith(`..${sep}`) && name !== ".." && !isAbsolute(name))
  );
};

async function trustedCheck(
  bundle: string,
  check: BehaviorCheck,
): Promise<BehaviorCheck> {
  const args = await Promise.all(
    check.args.map(async (argument) => {
      if (argument.startsWith("-") || isAbsolute(argument)) return argument;
      const candidate = resolve(bundle, argument);
      if (!inside(bundle, candidate))
        throw new Error("Judging asset path escapes the bundle.");
      try {
        await access(candidate);
        return candidate;
      } catch {
        return argument;
      }
    }),
  );
  return Object.freeze({ ...check, args: Object.freeze(args) });
}

export async function evaluateAcceptanceRelease(
  request: AcceptanceEvaluationRequest,
): Promise<AcceptanceEvaluationResult> {
  let manifest: OwnershipManifest;
  let bundle: string;
  try {
    const parsed: unknown = JSON.parse(
      await readFile(join(request.repository, OWNERSHIP_MANIFEST_PATH), "utf8"),
    );
    if (
      parsed === null ||
      typeof parsed !== "object" ||
      !("schemaVersion" in parsed) ||
      parsed.schemaVersion !== 2 ||
      !("judgingBundle" in parsed) ||
      parsed.judgingBundle === null ||
      typeof parsed.judgingBundle !== "object" ||
      !("identity" in parsed.judgingBundle) ||
      typeof parsed.judgingBundle.identity !== "string" ||
      !("integrity" in parsed.judgingBundle) ||
      typeof parsed.judgingBundle.integrity !== "string"
    )
      return assetFailure("Ownership manifest has no trusted judging bundle.");
    manifest = parsed as OwnershipManifest;
    bundle = await realpath(request.judgingBundle);
    if (
      manifest.judgingBundle.identity !== basename(bundle) ||
      manifest.judgingBundle.integrity !== (await fingerprint(bundle))
    )
      return assetFailure(
        "Trusted judging bundle identity or integrity does not match.",
      );
  } catch {
    return assetFailure(
      "Trusted judging bundle or ownership manifest is unavailable.",
    );
  }
  const policy = request.scenario.releases.acceptance;
  const select = async (
    ids: readonly string[],
    authored: readonly BehaviorCheck[],
  ) =>
    Promise.all(
      ids.map(async (id) => {
        const check = authored.find((candidate) => candidate.id === id);
        if (!check) throw new Error(`Release check '${id}' is unavailable.`);
        return trustedCheck(bundle, check);
      }),
    );
  const scenario: ScenarioDefinition = Object.freeze({
    ...request.scenario,
    checks: Object.freeze({
      required: Object.freeze(
        await select(policy.requiredChecks, request.scenario.checks.required),
      ),
      forbidden: Object.freeze(
        await select(policy.forbiddenChecks, request.scenario.checks.forbidden),
      ),
    }),
  });
  const result: EvaluationResult = await evaluateBranch({
    ...request,
    scenario,
    branch: ACCEPTANCE_BRANCH,
    baseline: ACCEPTANCE_BASELINE,
  });
  return Object.freeze({
    ...result,
    branch: ACCEPTANCE_BRANCH,
    baseline: ACCEPTANCE_BASELINE,
    tickets: Object.freeze([...policy.tickets]),
    requiredChecks: Object.freeze([...policy.requiredChecks]),
    forbiddenChecks: Object.freeze([...policy.forbiddenChecks]),
  });
}
