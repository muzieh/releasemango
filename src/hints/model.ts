import type { ScenarioDefinition } from "../domain/scenarios/index.js";
import type { WorkspaceStatus } from "../inspection/index.js";
import type { CoachingReport } from "../reporting/index.js";

export interface HintTarget {
  readonly release: "acceptance" | "production";
  readonly category: "required" | "forbidden" | "repository" | "infrastructure";
  readonly check: string;
  readonly ticket: string | null;
}
export type HintResponse =
  | {
      readonly state: "hint";
      readonly tier: number;
      readonly name: "concept" | "investigation" | "guidance";
      readonly target: HintTarget | null;
      readonly text: string;
      readonly nextTier: number;
    }
  | { readonly state: "solved"; readonly nextTier: number }
  | { readonly state: "exhausted"; readonly nextTier: number };
export interface HintSelectionRequest {
  readonly scenario: ScenarioDefinition;
  readonly status: WorkspaceStatus;
  readonly report: CoachingReport | null;
  readonly nextTier: number;
}
export interface HintDiagnostic {
  readonly code: string;
  readonly message: string;
}
export type HintResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly HintDiagnostic[] };
export interface HintRequest extends Omit<HintSelectionRequest, "nextTier"> {
  readonly repository: string;
}

export const freezeDeep = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>))
      freezeDeep(child);
  }
  return value;
};
