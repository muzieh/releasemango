import type { ScenarioDefinition } from "../domain/scenarios/index.js";
import type { GitAdapter, ProcessRunner } from "../git/index.js";

export const DEFAULT_EVIDENCE_LIMIT = 4_096;
export const EVIDENCE_TRUNCATION_MARKER = "\n…[truncated]";

export type CheckStatus = "pass" | "fail" | "error";
export type CheckCategory =
  "required" | "forbidden" | "repository" | "infrastructure";

export interface CheckEvidence {
  readonly stdout: string;
  readonly stderr: string;
  readonly summary: string;
}

export interface EvaluationCheckResult {
  readonly id: string;
  readonly category: CheckCategory;
  readonly status: CheckStatus;
  readonly durationMs: number;
  readonly evidence: CheckEvidence;
  readonly remediation?: string;
}

export interface EvaluationResult {
  readonly status: CheckStatus;
  readonly termination: "completed" | "cancelled";
  readonly durationMs: number;
  readonly checks: readonly EvaluationCheckResult[];
}

export interface EvaluationRequest {
  readonly repository: string;
  readonly branch: string;
  readonly baseline: string;
  readonly scenario: ScenarioDefinition;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly evidenceLimit?: number;
  readonly runner?: ProcessRunner;
  readonly git?: GitAdapter;
  readonly now?: () => number;
  readonly createTemporaryDirectory?: () => Promise<string>;
}
