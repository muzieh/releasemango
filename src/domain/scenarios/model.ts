export type DiagnosticPath = readonly (string | number)[];

export interface ScenarioDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly path: DiagnosticPath;
}

export type ScenarioResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostics: readonly ScenarioDiagnostic[] };

export interface ScenarioMetadata {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export interface TicketStatus {
  readonly id: string;
  readonly name: string;
}

export interface Ticket {
  readonly id: string;
  readonly title: string;
  readonly status: string;
}

export interface ScenarioCommit {
  readonly id: string;
  readonly ticket: string;
  readonly message: string;
  readonly dependsOn: readonly string[];
}

export interface ReleasePolicy {
  readonly baseline: string;
  readonly tickets: readonly string[];
  readonly requiredChecks: readonly string[];
  readonly forbiddenChecks: readonly string[];
}

export interface BehaviorCheck {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
}

export type HintTierName = "concept" | "investigation" | "guidance";
export type HintSelector =
  | { readonly release: "acceptance" | "production" }
  | { readonly category: ScoringCategory }
  | { readonly check: string }
  | { readonly ticket: string };
export interface HintVariant {
  readonly selector: HintSelector;
  readonly text: string;
}
export interface HintTier {
  readonly tier: number;
  readonly name: HintTierName;
  readonly fallback: string;
  readonly variants: readonly HintVariant[];
}

export type ScoringCategory =
  "required" | "forbidden" | "repository" | "infrastructure";

export interface ScenarioScoring {
  readonly weights: Readonly<Record<ScoringCategory, number>>;
  readonly mandatoryChecks: readonly string[];
}

export interface ScenarioDefinition {
  readonly schemaVersion: 1;
  readonly metadata: ScenarioMetadata;
  readonly seed: number;
  readonly workspace: {
    readonly initialMain: string;
  };
  readonly ticketStatuses: readonly TicketStatus[];
  readonly tickets: readonly Ticket[];
  readonly commits: readonly ScenarioCommit[];
  readonly releases: {
    readonly acceptance: ReleasePolicy;
    readonly production: ReleasePolicy;
  };
  readonly checks: {
    readonly required: readonly BehaviorCheck[];
    readonly forbidden: readonly BehaviorCheck[];
  };
  readonly hints: readonly HintTier[];
  readonly scoring: ScenarioScoring;
}
