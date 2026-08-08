export type InspectionCommand = "brief" | "status";

export interface InspectionDiagnostic {
  readonly code: string;
  readonly message: string;
}
export type InspectionResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly diagnostics: readonly InspectionDiagnostic[];
    };

export interface BriefRelease {
  readonly baseline: string;
  readonly tickets: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly forbiddenChecks: readonly string[];
}
export interface Brief {
  readonly goal: string;
  readonly tickets: readonly {
    readonly id: string;
    readonly title: string;
    readonly status: string;
  }[];
  readonly releases: {
    readonly acceptance: BriefRelease;
    readonly production: BriefRelease;
  };
}
export type WorktreeState = "clean" | "dirty" | "conflicted";
export interface TargetAvailability {
  readonly available: boolean;
  readonly reason?: { readonly code: string; readonly message: string };
}
export interface WorkspaceStatus {
  readonly head:
    | { readonly kind: "branch"; readonly name: string }
    | { readonly kind: "detached" };
  readonly branches: {
    readonly main: boolean;
    readonly acceptance: boolean;
    readonly production: boolean;
  };
  readonly worktree: WorktreeState;
  readonly evaluation: {
    readonly acceptance: TargetAvailability;
    readonly production: TargetAvailability;
  };
}

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>))
      deepFreeze(child);
  }
  return value;
}
