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

interface SemanticParts {
  workspace: ScenarioV1Input["workspace"] | undefined;
  ticketStatuses: ScenarioV1Input["ticketStatuses"] | undefined;
  tickets: ScenarioV1Input["tickets"] | undefined;
  commits: ScenarioV1Input["commits"] | undefined;
  releases: ScenarioV1Input["releases"] | undefined;
  checks: ScenarioV1Input["checks"] | undefined;
  hints: ScenarioV1Input["hints"] | undefined;
  scoring: ScenarioV1Input["scoring"] | undefined;
}

const validateReferences = (
  parts: SemanticParts,
  diagnostics: MutableDiagnostic[],
): void => {
  if (
    parts.workspace &&
    parts.commits &&
    !parts.commits.some(({ id }) => id === parts.workspace?.initialMain)
  )
    diagnostics.push(
      diagnostic(
        "workspace.initial-main-not-found",
        `Initial main commit '${parts.workspace.initialMain}' does not exist.`,
        ["workspace", "initialMain"],
      ),
    );
  if (parts.ticketStatuses && parts.tickets) {
    const statusIds = new Set(parts.ticketStatuses.map(({ id }) => id));
    parts.tickets.forEach((ticket, index) => {
      if (!statusIds.has(ticket.status))
        diagnostics.push(
          diagnostic(
            "ticket.status-not-found",
            `Ticket status '${ticket.status}' does not exist.`,
            ["tickets", index, "status"],
          ),
        );
    });
  }
  if (parts.commits) {
    const commitIds = new Set(parts.commits.map(({ id }) => id));
    const ticketIds = parts.tickets
      ? new Set(parts.tickets.map(({ id }) => id))
      : undefined;
    parts.commits.forEach((commit, index) => {
      if (ticketIds && !ticketIds.has(commit.ticket))
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
  }
  if (parts.releases) {
    const commitIds = parts.commits
      ? new Set(parts.commits.map(({ id }) => id))
      : undefined;
    const ticketIds = parts.tickets
      ? new Set(parts.tickets.map(({ id }) => id))
      : undefined;
    const checkIds = parts.checks
      ? {
          requiredChecks: new Set(parts.checks.required.map(({ id }) => id)),
          forbiddenChecks: new Set(parts.checks.forbidden.map(({ id }) => id)),
        }
      : undefined;
    (["acceptance", "production"] as const).forEach((name) => {
      const policy = parts.releases?.[name];
      if (!policy) return;
      if (commitIds && !commitIds.has(policy.baseline))
        diagnostics.push(
          diagnostic(
            "release.baseline-not-found",
            `Release baseline '${policy.baseline}' does not exist.`,
            ["releases", name, "baseline"],
          ),
        );
      policy.tickets.forEach((ticket, index) => {
        if (ticketIds && !ticketIds.has(ticket))
          diagnostics.push(
            diagnostic(
              "release.ticket-not-found",
              `Release ticket '${ticket}' does not exist.`,
              ["releases", name, "tickets", index],
            ),
          );
      });
      const required = new Set<string>();
      const forbidden = new Set<string>();
      for (const [kind, ids, seen] of [
        ["requiredChecks", policy.requiredChecks, required],
        ["forbiddenChecks", policy.forbiddenChecks, forbidden],
      ] as const) {
        ids.forEach((id, index) => {
          const path = ["releases", name, kind, index] as const;
          if (checkIds && !checkIds[kind].has(id))
            diagnostics.push(
              diagnostic(
                "release.check-not-found",
                `Release check '${id}' does not exist.`,
                path,
              ),
            );
          if (seen.has(id))
            diagnostics.push(
              diagnostic(
                "release.duplicate-check",
                `Release check '${id}' is declared more than once.`,
                path,
              ),
            );
          if (kind === "forbiddenChecks" && required.has(id))
            diagnostics.push(
              diagnostic(
                "release.contradictory-check",
                `Release check '${id}' cannot be both required and forbidden.`,
                path,
              ),
            );
          seen.add(id);
        });
      }
    });
  }
};

const validateCycles = (
  commits: ScenarioV1Input["commits"],
  diagnostics: MutableDiagnostic[],
): void => {
  const byId = new Map(
    commits.map((commit, index) => [commit.id, { commit, index }]),
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
  commits.forEach(({ id }) => {
    visit(id);
  });
};

const validateChecks = (
  checks: ScenarioV1Input["checks"],
  diagnostics: MutableDiagnostic[],
): void => {
  const safeCommand = /^[A-Za-z0-9_./-]+$/u;
  const seen = new Set<string>();
  (["required", "forbidden"] as const).forEach((kind) => {
    checks[kind].forEach((check, index) => {
      if (seen.has(check.id))
        diagnostics.push(
          diagnostic(
            "check.duplicate-id",
            `Duplicate identifier '${check.id}'.`,
            ["checks", kind, index, "id"],
          ),
        );
      seen.add(check.id);
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
};

const validateHints = (
  hints: ScenarioV1Input["hints"],
  parts: Pick<SemanticParts, "tickets" | "checks" | "commits">,
  diagnostics: MutableDiagnostic[],
): void => {
  const names = ["concept", "investigation", "guidance"] as const;
  const tickets = new Set(parts.tickets?.map(({ id }) => id) ?? []);
  const checks = new Set([
    ...(parts.checks?.required.map(({ id }) => id) ?? []),
    ...(parts.checks?.forbidden.map(({ id }) => id) ?? []),
    "repository.branch",
    "repository.baseline",
    "repository.worktree",
    "repository.clean",
    "repository.conflicts",
    "repository.ancestry",
    "repository.setup",
    "repository.cleanup",
    "infrastructure.judging-assets",
  ]);
  const commitIds = parts.commits?.map(({ id }) => id) ?? [];
  const unsafe = (text: string): boolean =>
    commitIds.some((id) => text.includes(id)) ||
    /\b[0-9a-f]{7,40}\b/iu.test(text) ||
    /(?:^|\s)(?:git|pnpm|npm|yarn)\s+[-\w]/iu.test(text) ||
    /cherry-pick|\bthen\b|hidden expected source/iu.test(text);
  hints.forEach((hint, index) => {
    if (hint.tier !== index + 1 || hint.name !== names[index])
      diagnostics.push(
        diagnostic(
          "hint.invalid-tier",
          "Hint tiers must be unique, ordered, and contiguous from 1.",
          ["hints", index, "tier"],
        ),
      );
    if (unsafe(hint.fallback))
      diagnostics.push(
        diagnostic(
          "hint.unsafe-text",
          "Hint text exposes unsafe authored solution detail.",
          ["hints", index, "fallback"],
        ),
      );
    const seen = new Set<string>();
    hint.variants.forEach((variant, variantIndex) => {
      const [kind, value] = Object.entries(variant.selector)[0] as [
        string,
        string,
      ];
      const path = [
        "hints",
        index,
        "variants",
        variantIndex,
        "selector",
        kind,
      ] as const;
      const key = `${kind}:${value}`;
      if (seen.has(key))
        diagnostics.push(
          diagnostic(
            "hint.duplicate-selector",
            `Hint selector '${key}' is declared more than once.`,
            path,
          ),
        );
      seen.add(key);
      if (
        (kind === "ticket" && !tickets.has(value)) ||
        (kind === "check" && !checks.has(value))
      )
        diagnostics.push(
          diagnostic(
            "hint.selector-not-found",
            `Hint selector '${key}' does not exist.`,
            path,
          ),
        );
      if (
        (kind === "release" &&
          value !== "acceptance" &&
          value !== "production") ||
        (kind === "category" &&
          !["required", "forbidden", "repository", "infrastructure"].includes(
            value,
          ))
      )
        diagnostics.push(
          diagnostic(
            "hint.selector-not-found",
            `Hint selector '${key}' does not exist.`,
            path,
          ),
        );
      if (unsafe(variant.text))
        diagnostics.push(
          diagnostic(
            "hint.unsafe-text",
            "Hint text exposes unsafe authored solution detail.",
            ["hints", index, "variants", variantIndex, "text"],
          ),
        );
    });
  });
};

const validateScoring = (
  scoring: ScenarioV1Input["scoring"],
  checks: ScenarioV1Input["checks"] | undefined,
  diagnostics: MutableDiagnostic[],
): void => {
  for (const [name, weight] of Object.entries(scoring.weights)) {
    if (weight < 0)
      diagnostics.push(
        diagnostic(
          "scoring.negative-weight",
          `Scoring weight '${name}' cannot be negative.`,
          ["scoring", "weights", name],
        ),
      );
  }
  const total = Object.values(scoring.weights).reduce(
    (sum, weight) => sum + weight,
    0,
  );
  if (total !== 100)
    diagnostics.push(
      diagnostic(
        "scoring.invalid-total",
        `Scoring weights must total 100; received ${String(total)}.`,
        ["scoring", "weights"],
      ),
    );
  const fixedIds = new Set([
    "repository.branch",
    "repository.baseline",
    "repository.worktree",
    "repository.clean",
    "repository.conflicts",
    "repository.ancestry",
    "repository.setup",
    "repository.cleanup",
    "infrastructure.judging-assets",
  ]);
  const known = new Set([
    ...(checks?.required.map(({ id }) => id) ?? []),
    ...(checks?.forbidden.map(({ id }) => id) ?? []),
    ...fixedIds,
  ]);
  const seen = new Set<string>();
  scoring.mandatoryChecks.forEach((id, index) => {
    const path = ["scoring", "mandatoryChecks", index] as const;
    if (!known.has(id))
      diagnostics.push(
        diagnostic(
          "scoring.mandatory-check-not-found",
          `Mandatory check '${id}' does not exist.`,
          path,
        ),
      );
    if (seen.has(id))
      diagnostics.push(
        diagnostic(
          "scoring.duplicate-mandatory-check",
          `Mandatory check '${id}' is declared more than once.`,
          path,
        ),
      );
    seen.add(id);
  });
};

const validateSemantics = (parts: SemanticParts): MutableDiagnostic[] => {
  const diagnostics: MutableDiagnostic[] = [];
  if (parts.ticketStatuses)
    duplicates(
      parts.ticketStatuses,
      "ticketStatuses",
      "ticket-status.duplicate-id",
      diagnostics,
    );
  if (parts.tickets)
    duplicates(parts.tickets, "tickets", "ticket.duplicate-id", diagnostics);
  if (parts.commits) {
    duplicates(parts.commits, "commits", "commit.duplicate-id", diagnostics);
    validateCycles(parts.commits, diagnostics);
  }
  validateReferences(parts, diagnostics);
  if (parts.checks) validateChecks(parts.checks, diagnostics);
  if (parts.hints) validateHints(parts.hints, parts, diagnostics);
  if (parts.scoring) validateScoring(parts.scoring, parts.checks, diagnostics);
  return diagnostics;
};

const safeSemanticParts = (input: unknown): SemanticParts => {
  const value = input !== null && typeof input === "object" ? input : {};
  const fields = value as Record<string, unknown>;
  const workspace = scenarioV1Schema.shape.workspace.safeParse(
    fields.workspace,
  );
  const ticketStatuses = scenarioV1Schema.shape.ticketStatuses.safeParse(
    fields.ticketStatuses,
  );
  const tickets = scenarioV1Schema.shape.tickets.safeParse(fields.tickets);
  const commits = scenarioV1Schema.shape.commits.safeParse(fields.commits);
  const releases = scenarioV1Schema.shape.releases.safeParse(fields.releases);
  const checks = scenarioV1Schema.shape.checks.safeParse(fields.checks);
  const hints = scenarioV1Schema.shape.hints.safeParse(fields.hints);
  const scoring = scenarioV1Schema.shape.scoring.safeParse(fields.scoring);
  return {
    workspace: workspace.success ? workspace.data : undefined,
    ticketStatuses: ticketStatuses.success ? ticketStatuses.data : undefined,
    tickets: tickets.success ? tickets.data : undefined,
    commits: commits.success ? commits.data : undefined,
    releases: releases.success ? releases.data : undefined,
    checks: checks.success ? checks.data : undefined,
    hints: hints.success ? hints.data : undefined,
    scoring: scoring.success ? scoring.data : undefined,
  };
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
    const semanticDiagnostics = validateSemantics(safeSemanticParts(input));
    return {
      ok: false,
      diagnostics: [
        ...parsed.error.issues.map((issue) => {
          const path =
            issue.path.length === 1 && issue.path[0] === "workspace"
              ? ["workspace", "initialMain"]
              : issue.path.map((segment) =>
                  typeof segment === "symbol" ? String(segment) : segment,
                );
          if (issue.code === "unrecognized_keys" && issue.keys.length === 1)
            path.push(issue.keys[0] ?? "unknown");
          const selectorIssue =
            path[0] === "hints" &&
            path[2] === "variants" &&
            path[4] === "selector";
          return diagnostic(
            selectorIssue ? "hint.selector-not-found" : "schema.invalid",
            issue.message,
            path,
          );
        }),
        ...semanticDiagnostics,
      ],
    };
  }
  const diagnostics = validateSemantics(parsed.data);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    value: freezeDeep(structuredClone(parsed.data)) as ScenarioDefinition,
  };
};

export type { ScenarioDiagnostic };
