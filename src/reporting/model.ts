import type { ScenarioScoring } from "../domain/scenarios/index.js";
import type {
  CheckCategory,
  CheckEvidence,
  CheckStatus,
  EvaluationResult,
} from "../evaluator/index.js";

export const REPORT_CATEGORIES = [
  "required",
  "forbidden",
  "repository",
  "infrastructure",
] as const;

export type ReportVerdict = "pass" | "fail" | "error" | "cancelled";
export type ReportSeverity = "none" | "warning" | "blocking" | "system";

export interface ReportCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly evidence: CheckEvidence;
}

export interface ReportGroup {
  readonly category: CheckCategory;
  readonly checks: readonly ReportCheck[];
}

export interface CoachingReport {
  readonly release: {
    readonly branch: string;
    readonly baseline: string;
    readonly tickets: readonly string[];
  };
  readonly score: number | null;
  readonly verdict: ReportVerdict;
  readonly severity: ReportSeverity;
  readonly groups: readonly ReportGroup[];
  readonly nextAction: string | null;
}

export interface BuildReportInput {
  readonly scoring: ScenarioScoring;
  readonly authoredCommitIds?: readonly string[];
  readonly release: CoachingReport["release"];
  readonly evaluation: EvaluationResult;
}

const freezeDeep = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
};

const unsafeCoaching = (value: string): boolean =>
  /\b[0-9a-f]{7,40}\b/iu.test(value) ||
  /`[^`]+`/u.test(value) ||
  /(?:^|\s)(?:git|pnpm|npm|yarn|node|rm|cp|mv)\s+[-\w]/iu.test(value) ||
  /(?:\bthen\b|\bstep\s+\d+\b)/iu.test(value);

const bounded = (value: string, limit = 512): string =>
  value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;

const safeEvidence = (
  value: string,
  authoredCommitIds: readonly string[],
): string => {
  let result = value.replace(/\b[0-9a-f]{7,40}\b/giu, "[redacted]");
  for (const id of authoredCommitIds)
    result = result.split(id).join("[redacted]");
  return bounded(result);
};

export const buildReport = (input: BuildReportInput): CoachingReport => {
  const groups = REPORT_CATEGORIES.map((category) => ({
    category,
    checks: input.evaluation.checks
      .filter((check) => check.category === category)
      .map((check) => ({
        id: check.id,
        status: check.status,
        evidence: {
          stdout: safeEvidence(
            check.evidence.stdout,
            input.authoredCommitIds ?? [],
          ),
          stderr: safeEvidence(
            check.evidence.stderr,
            input.authoredCommitIds ?? [],
          ),
          summary: safeEvidence(
            check.evidence.summary,
            input.authoredCommitIds ?? [],
          ),
        },
      })),
  })).filter(({ checks }) => checks.length > 0);

  let total = 0;
  for (const category of REPORT_CATEGORIES) {
    const checks = input.evaluation.checks.filter(
      (check) => check.category === category,
    );
    const weight = input.scoring.weights[category];
    total +=
      checks.length === 0
        ? weight
        : (weight * checks.filter(({ status }) => status === "pass").length) /
          checks.length;
  }
  const numericScore = Math.floor(total + 0.5);
  const systemError = input.evaluation.checks.some(
    ({ category, status }) =>
      category === "infrastructure" && status === "error",
  );
  const mandatoryFailure = input.evaluation.checks.some(
    ({ id, status }) =>
      input.scoring.mandatoryChecks.includes(id) && status !== "pass",
  );
  const verdict: ReportVerdict =
    input.evaluation.termination === "cancelled"
      ? "cancelled"
      : systemError
        ? "error"
        : mandatoryFailure || numericScore < 80
          ? "fail"
          : "pass";
  const severity: ReportSeverity =
    verdict === "cancelled" || verdict === "error"
      ? "system"
      : verdict === "pass"
        ? "none"
        : mandatoryFailure
          ? "blocking"
          : "warning";
  let nextAction: string | null = null;
  if (verdict !== "pass") {
    for (const check of input.evaluation.checks) {
      if (check.status === "pass") continue;
      for (const candidate of [check.remediation, check.evidence.summary]) {
        const text = candidate?.trim();
        if (text && !unsafeCoaching(text)) {
          nextAction = bounded(text);
          break;
        }
      }
      if (nextAction) break;
    }
    nextAction ??=
      "Review the first non-passing check and its public requirements.";
  }
  return freezeDeep({
    release: {
      branch: input.release.branch,
      baseline: input.release.baseline,
      tickets: [...input.release.tickets],
    },
    score: verdict === "error" || verdict === "cancelled" ? null : numericScore,
    verdict,
    severity,
    groups,
    nextAction,
  });
};
