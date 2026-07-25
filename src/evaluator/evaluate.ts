import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { BehaviorCheck } from "../domain/scenarios/index.js";
import {
  createGitAdapter,
  createProcessRunner,
  type GitFailure,
  type ProcessResult,
  type ProcessRunner,
} from "../git/index.js";
import {
  DEFAULT_EVIDENCE_LIMIT,
  EVIDENCE_TRUNCATION_MARKER,
  type CheckCategory,
  type CheckStatus,
  type EvaluationCheckResult,
  type EvaluationRequest,
  type EvaluationResult,
} from "./model.js";

export async function evaluateBranch(
  request: EvaluationRequest,
): Promise<EvaluationResult> {
  const now = request.now ?? (() => performance.now());
  const started = now();
  const limit = request.evidenceLimit ?? DEFAULT_EVIDENCE_LIMIT;
  const git = request.git ?? createGitAdapter(request.repository);
  const runner = request.runner ?? createProcessRunner();
  const checks: EvaluationCheckResult[] = [];
  let worktree: string | undefined;
  let worktreeRegistered = false;
  let ownsTemporaryDirectory = false;
  let cancelled = false;

  if (!isExactBranchName(request.branch)) {
    checks.push(
      invalidRefCheck(
        "repository.branch",
        "Branch must be an exact local branch name",
        now() - started,
        limit,
      ),
    );
    return finish(checks, started, now, false);
  }
  const branchRef = `refs/heads/${request.branch}`;
  const branch = await git.resolveRef(branchRef, signalOptions(request.signal));
  if (!branch.ok) {
    checks.push(
      fromGitFailure("repository.branch", branch, now() - started, limit),
    );
    return finish(checks, started, now, isCancelledFailure(branch));
  }
  if (!isExactNamedRef(request.baseline)) {
    checks.push(
      invalidRefCheck(
        "repository.baseline",
        "Baseline must be an exact fully-qualified named ref",
        now() - started,
        limit,
      ),
    );
    return finish(checks, started, now, false);
  }
  const baseline = await git.resolveRef(
    request.baseline,
    signalOptions(request.signal),
  );
  if (!baseline.ok) {
    checks.push(
      fromGitFailure("repository.baseline", baseline, now() - started, limit),
    );
    return finish(checks, started, now, isCancelledFailure(baseline));
  }

  try {
    worktree = request.createTemporaryDirectory
      ? await request.createTemporaryDirectory()
      : await mkdtemp(join(tmpdir(), "releasemango-evaluation-"));
    ownsTemporaryDirectory = request.createTemporaryDirectory === undefined;
    const added = await git.addDetachedWorktree(worktree, branchRef, {
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    if (!added.ok) {
      checks.push(
        fromGitFailure("repository.worktree", added, now() - started, limit),
      );
      cancelled = isCancelledFailure(added);
    } else {
      worktreeRegistered = true;
      for (const [category, authored] of [
        ["required", request.scenario.checks.required],
        ["forbidden", request.scenario.checks.forbidden],
      ] as const) {
        for (const check of authored) {
          const result = await runBehavior(
            check,
            category,
            worktree,
            request.timeoutMs,
            request.signal,
            runner,
            now,
            limit,
          );
          checks.push(result.check);
          if (result.cancelled) {
            cancelled = true;
            break;
          }
        }
        if (cancelled) break;
      }
      if (!cancelled) {
        const isolatedGit = createGitAdapter(worktree);
        const statusStarted = now();
        const status = await isolatedGit.status();
        if (status.ok) {
          checks.push(
            makeCheck(
              "repository.clean",
              "repository",
              status.entries.length === 0 ? "pass" : "fail",
              now() - statusStarted,
              {
                summary:
                  status.entries.length === 0
                    ? "Tree is clean"
                    : "Evaluated tree is dirty",
              },
              limit,
            ),
          );
          const conflicts = status.entries.filter(
            ({ index, worktree: state }) =>
              index === "U" ||
              state === "U" ||
              (index === "A" && state === "A") ||
              (index === "D" && state === "D"),
          );
          checks.push(
            makeCheck(
              "repository.conflicts",
              "repository",
              conflicts.length === 0 ? "pass" : "fail",
              0,
              {
                summary:
                  conflicts.length === 0
                    ? "No unresolved conflicts"
                    : "Unresolved conflicts exist",
              },
              limit,
            ),
          );
        } else {
          checks.push(
            fromGitFailure(
              "repository.clean",
              status,
              now() - statusStarted,
              limit,
            ),
          );
          checks.push(fromGitFailure("repository.conflicts", status, 0, limit));
        }
        const ancestryStarted = now();
        const ancestry = await git.isAncestor(baseline.id, branch.id, {
          ...(request.signal === undefined ? {} : { signal: request.signal }),
        });
        if (!ancestry.ok && isCancelledFailure(ancestry)) cancelled = true;
        checks.push(
          ancestry.ok
            ? makeCheck(
                "repository.ancestry",
                "repository",
                ancestry.isAncestor ? "pass" : "fail",
                now() - ancestryStarted,
                {
                  summary: ancestry.isAncestor
                    ? "Branch descends from baseline"
                    : "Branch does not descend from baseline",
                },
                limit,
              )
            : fromGitFailure(
                "repository.ancestry",
                ancestry,
                now() - ancestryStarted,
                limit,
              ),
        );
      }
    }
  } catch (error: unknown) {
    checks.push(
      makeCheck(
        "repository.setup",
        "infrastructure",
        "error",
        now() - started,
        {
          summary:
            error instanceof Error ? error.message : "Evaluation setup failed",
        },
        limit,
      ),
    );
  } finally {
    if (worktree !== undefined && worktreeRegistered) {
      const cleanupStarted = now();
      const removed = await git.removeWorktree(worktree);
      if (!removed.ok) {
        checks.push(
          fromGitFailure(
            "repository.cleanup",
            removed,
            now() - cleanupStarted,
            limit,
          ),
        );
      }
    } else if (worktree !== undefined && ownsTemporaryDirectory) {
      try {
        await rm(worktree, { recursive: true, force: true });
      } catch (error: unknown) {
        checks.push(
          makeCheck(
            "repository.cleanup",
            "infrastructure",
            "error",
            0,
            {
              summary:
                error instanceof Error
                  ? error.message
                  : "Temporary directory cleanup failed",
            },
            limit,
          ),
        );
      }
    }
  }
  return finish(checks, started, now, cancelled);
}

async function runBehavior(
  check: BehaviorCheck,
  category: "required" | "forbidden",
  cwd: string,
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  runner: ProcessRunner,
  now: () => number,
  limit: number,
): Promise<{ check: EvaluationCheckResult; cancelled: boolean }> {
  const started = now();
  const process = await runner.run({
    executable: check.command,
    args: check.args,
    cwd,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(signal === undefined ? {} : { signal }),
  });
  const duration = now() - started;
  if (process.kind === "cancelled") {
    return {
      check: makeCheck(
        check.id,
        category,
        "error",
        duration,
        evidence(process),
        limit,
        "Evaluation was cancelled",
      ),
      cancelled: true,
    };
  }
  let status: CheckStatus;
  if (process.kind === "timed-out") status = "fail";
  else if (process.kind !== "completed") status = "error";
  else {
    const success = process.exitCode === 0;
    status = (category === "required" ? success : !success) ? "pass" : "fail";
  }
  return {
    check: makeCheck(
      check.id,
      category,
      status,
      duration,
      evidence(process),
      limit,
    ),
    cancelled: false,
  };
}

function evidence(process: ProcessResult): {
  stdout: string;
  stderr: string;
  summary: string;
} {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    summary:
      process.kind === "completed"
        ? `Command exited with code ${String(process.exitCode)}`
        : process.message,
  };
}

function fromGitFailure(
  id: string,
  failure: GitFailure,
  durationMs: number,
  limit: number,
): EvaluationCheckResult {
  return makeCheck(
    id,
    "infrastructure",
    "error",
    durationMs,
    evidence(failure.process),
    limit,
  );
}

function isCancelledFailure(failure: GitFailure): boolean {
  return failure.process.kind === "cancelled";
}

function signalOptions(signal: AbortSignal | undefined) {
  return signal === undefined ? {} : { signal };
}

function isExactBranchName(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("-") &&
    !value.startsWith("/") &&
    !value.endsWith("/") &&
    !value.endsWith(".") &&
    !value.includes("..") &&
    !value.includes("@{") &&
    !/[~^:?*[\]\\\s]/u.test(value)
  );
}

function isExactNamedRef(value: string): boolean {
  const prefix = value.startsWith("refs/heads/")
    ? "refs/heads/"
    : value.startsWith("refs/tags/")
      ? "refs/tags/"
      : undefined;
  return prefix !== undefined && isExactBranchName(value.slice(prefix.length));
}

function invalidRefCheck(
  id: string,
  summary: string,
  durationMs: number,
  limit: number,
): EvaluationCheckResult {
  return makeCheck(
    id,
    "infrastructure",
    "error",
    durationMs,
    { summary },
    limit,
  );
}

function makeCheck(
  id: string,
  category: CheckCategory,
  status: CheckStatus,
  durationMs: number,
  raw: {
    readonly stdout?: string;
    readonly stderr?: string;
    readonly summary: string;
  },
  limit: number,
  remediation = "Inspect the evidence and correct the evaluated branch.",
): EvaluationCheckResult {
  const bounded = (value = "") =>
    value.length <= limit
      ? value
      : `${value.slice(0, Math.max(0, limit - EVIDENCE_TRUNCATION_MARKER.length))}${EVIDENCE_TRUNCATION_MARKER}`;
  const value = {
    id,
    category,
    status,
    durationMs: Math.max(0, durationMs),
    evidence: Object.freeze({
      stdout: bounded(raw.stdout),
      stderr: bounded(raw.stderr),
      summary: bounded(raw.summary),
    }),
    ...(status === "pass" ? {} : { remediation }),
  };
  return Object.freeze(value);
}

function finish(
  checks: EvaluationCheckResult[],
  started: number,
  now: () => number,
  cancelled: boolean,
): EvaluationResult {
  const status: CheckStatus = checks.some(({ status }) => status === "error")
    ? "error"
    : checks.some(({ status }) => status === "fail")
      ? "fail"
      : "pass";
  return Object.freeze({
    status,
    termination: cancelled ? "cancelled" : "completed",
    durationMs: Math.max(0, now() - started),
    checks: Object.freeze([...checks]),
  });
}
