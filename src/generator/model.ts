import type { ScenarioDefinition } from "../domain/scenarios/index.js";

export const OWNERSHIP_MANIFEST_PATH = ".git/releasemango/ownership-v1.json";

export type GenerationPhase =
  | "validation"
  | "staging"
  | "copy"
  | "git-initialization"
  | "history"
  | "refs"
  | "manifest"
  | "publish";

export interface FixtureUnit {
  readonly requires: readonly string[];
  readonly files: readonly string[];
}

export interface FixtureManifest {
  readonly version: number;
  readonly units: Readonly<Record<string, FixtureUnit>>;
}

export interface GenerationRequest {
  readonly scenario: ScenarioDefinition;
  readonly fixture: string;
  readonly destination: string;
  readonly generatorVersion: string;
  readonly seed?: number;
  readonly overwrite?: boolean;
  /** Test-only boundary used to prove phase cleanup and rollback. */
  readonly failAt?: GenerationPhase;
  /** Test-only boundary used to prove replacement rollback after backup. */
  readonly failPublishAfterBackup?: boolean;
}

export interface OwnershipManifest {
  readonly schemaVersion: 1;
  readonly scenarioId: string;
  readonly seed: number;
  readonly generatorVersion: string;
  readonly fixture: string;
  readonly fixtureIdentity: string;
  readonly workspaceInitialMain: string;
  readonly generatedRefs: Readonly<Record<string, string>>;
}

export interface GenerationResult {
  readonly destination: string;
  readonly commits: Readonly<Record<string, string>>;
  readonly refs: Readonly<Record<string, string>>;
  readonly manifest: OwnershipManifest;
}

export class GenerationError extends Error {
  readonly phase: GenerationPhase;

  constructor(phase: GenerationPhase, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "GenerationError";
    this.phase = phase;
  }
}
