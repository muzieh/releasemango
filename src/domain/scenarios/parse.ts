import { parseDocument } from "yaml";

import type {
  DiagnosticPath,
  ScenarioDefinition,
  ScenarioDiagnostic,
  ScenarioResult,
} from "./model.js";
import { scenarioV1Schema, type ScenarioV1Input } from "./schema.js";

interface MutableDiagnostic {
  code: string;
  message: string;
  path: (string | number)[];
}

const diagnostic = (
  code: string,
  message: string,
  path: DiagnosticPath = [],
): MutableDiagnostic => ({ code, message, path: [...path] });

const freezeDeep = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freezeDeep(child);
  }
  return value;
};

const duplicates = (
  values: readonly { id: string }[],
  collection: string,
  code: string,
  diagnostics: MutableDiagnostic[],
): void => {
  const seen = new Set<string>();
  values.forEach(({ id }, index) => {
    if (seen.has(id)) {
      diagnostics.push(
        diagnostic(code, `Duplicate identifier '${id}'.`, [
          collection,
          index,
          "id",
        ]),
      );
    }
    seen.add(id);
  });
};

const validateReferences = (
  scenario: ScenarioV1Input,
  diagnostics: MutableDiagnostic[],
): void => {
  const statusIds = new Set(scenario.ticketStatuses.map(({ id }) => id));
  const ticketIds = new Set(scenario.tickets.map(({ id }) => id));
  const commitIds = new Set(scenario.commits.map(({ id }) => id));

  scenario.tickets.forEach((ticket, index) => {
    if (!statusIds.has(ticket.status))
      diagnostics.push(
        diagnostic(
          "ticket.status-not-found",
          `Ticket status '${ticket.status}' does not exist.`,
          ["tickets", index, "status"],
        ),
      );
  });
  scenario.commits.forEach((commit, index) => {
    if (!ticketIds.has(commit.ticket))
      diagnostics.push(
        diagnostic(
          "commit.ticket-not-found",
          `Ticket '${commit.ticket}' does not exist.`,
          ["commits", index, "ticket"],
        ),
      );
    commit.dependsOn.forEach((dependency, dependencyIndex) => {
      if (!commitIds.has(dependency))
        diagnostics.push(
          diagnostic(
            "commit.dependency-not-found",
            `Commit dependency '${dependency}' does not exist.`,
            ["commits", index, "dependsOn", dependencyIndex],
          ),
        );
    });
  });
  (["acceptance", "production"] as const).forEach((name) => {
    const policy = scenario.releases[name];
    if (!commitIds.has(policy.baseline))
      diagnostics.push(
        diagnostic(
          "release.baseline-not-found",
          `Release baseline '${policy.baseline}' does not exist.`,
          ["releases", name, "baseline"],
        ),
      );
    policy.tickets.forEach((ticket, index) => {
      if (!ticketIds.has(ticket))
        diagnostics.push(
          diagnostic(
            "release.ticket-not-found",
            `Release ticket '${ticket}' does not exist.`,
            ["releases", name, "tickets", index],
          ),
        );
    });
  });
};

const validateCycles = (
  scenario: ScenarioV1Input,
  diagnostics: MutableDiagnostic[],
): void => {
  const byId = new Map(
    scenario.commits.map((commit, index) => [commit.id, { commit, index }]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reported = new Set<string>();
  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const entry = byId.get(id);
    if (!entry) return;
    visiting.add(id);
    for (const dependency of entry.commit.dependsOn) {
      if (visiting.has(dependency) && !reported.has(id)) {
        diagnostics.push(
          diagnostic(
            "commit.dependency-cycle",
            `Commit '${id}' participates in a dependency cycle.`,
            ["commits", entry.index, "dependsOn"],
          ),
        );
        reported.add(id);
      } else visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  scenario.commits.forEach(({ id }) => {
    visit(id);
  });
};

const validateChecksHintsAndScoring = (
  scenario: ScenarioV1Input,
  diagnostics: MutableDiagnostic[],
): void => {
  const safeCommand = /^[A-Za-z0-9_./-]+$/u;
  (["required", "forbidden"] as const).forEach((kind) => {
    duplicates(
      scenario.checks[kind],
      `checks.${kind}`,
      "check.duplicate-id",
      diagnostics,
    );
    scenario.checks[kind].forEach((check, index) => {
      if (
        !safeCommand.test(check.command) ||
        check.args.some((argument) => /[\0\r\n]/u.test(argument))
      ) {
        diagnostics.push(
          diagnostic(
            "check.unsafe-command",
            `Check '${check.id}' contains an unsafe command or argument.`,
            ["checks", kind, index],
          ),
        );
      }
    });
  });
  scenario.hints.forEach((hint, index) => {
    if (hint.tier !== index + 1)
      diagnostics.push(
        diagnostic(
          "hint.invalid-tier",
          "Hint tiers must be unique, ordered, and contiguous from 1.",
          ["hints", index, "tier"],
        ),
      );
  });
  for (const [name, weight] of Object.entries(scenario.scoring)) {
    if (weight < 0)
      diagnostics.push(
        diagnostic(
          "scoring.negative-weight",
          `Scoring weight '${name}' cannot be negative.`,
          ["scoring", name],
        ),
      );
  }
  const total = Object.values(scenario.scoring).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  if (total !== 100)
    diagnostics.push(
      diagnostic(
        "scoring.invalid-total",
        `Scoring weights must total 100; received ${String(total)}.`,
        ["scoring"],
      ),
    );
};

const validateSemantics = (scenario: ScenarioV1Input): MutableDiagnostic[] => {
  const diagnostics: MutableDiagnostic[] = [];
  duplicates(
    scenario.ticketStatuses,
    "ticketStatuses",
    "ticket-status.duplicate-id",
    diagnostics,
  );
  duplicates(scenario.tickets, "tickets", "ticket.duplicate-id", diagnostics);
  duplicates(scenario.commits, "commits", "commit.duplicate-id", diagnostics);
  validateReferences(scenario, diagnostics);
  validateCycles(scenario, diagnostics);
  validateChecksHintsAndScoring(scenario, diagnostics);
  return diagnostics;
};

export const parseScenario = (
  source: string,
): ScenarioResult<ScenarioDefinition> => {
  const document = parseDocument(source, {
    prettyErrors: false,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    return {
      ok: false,
      diagnostics: document.errors.map((error) =>
        diagnostic("yaml.syntax", `Invalid YAML: ${error.message}`, []),
      ),
    };
  }
  const input: unknown = document.toJS();
  if (
    input !== null &&
    typeof input === "object" &&
    "schemaVersion" in input &&
    (input as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic(
          "schema.unsupported-version",
          "Only schemaVersion 1 is supported.",
          ["schemaVersion"],
        ),
      ],
    };
  }
  const parsed = scenarioV1Schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: parsed.error.issues.map((issue) =>
        diagnostic(
          "schema.invalid",
          issue.message,
          issue.path.map((segment) =>
            typeof segment === "symbol" ? String(segment) : segment,
          ),
        ),
      ),
    };
  }
  const diagnostics = validateSemantics(parsed.data);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return { ok: true, value: freezeDeep(structuredClone(parsed.data)) };
};

export type { ScenarioDiagnostic };
