import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import { parseScenario } from "../../../src/domain/scenarios/index.js";

const validYaml = await readFile(
  new URL("../../fixtures/scenarios/minimal-v1.yaml", import.meta.url),
  "utf8",
);
const replace = (search: string, replacement: string): string =>
  validYaml.replace(search, replacement);

describe("parseScenario", () => {
  it("loads immutable version 1 data and preserves authored order", () => {
    const result = parseScenario(validYaml);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.schemaVersion).toBe(1);
    expect(result.value.workspace.initialMain).toBe("commit-a");
    expect(Object.isFrozen(result.value.workspace)).toBe(true);
    expect(result.value.commits.map(({ id }) => id)).toEqual([
      "commit-b",
      "commit-a",
    ]);
    expect(result.value.checks.required.map(({ id }) => id)).toEqual([
      "typecheck",
      "tests",
    ]);
    expect(result.value.hints.map(({ tier }) => tier)).toEqual([1, 2]);
    expect(result.value.releases.acceptance).toEqual({
      baseline: "commit-a",
      tickets: ["TEA-101"],
    });
    expect(result.value.releases.production).toEqual({
      baseline: "commit-b",
      tickets: ["TEA-101", "TEA-102"],
    });
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.commits)).toBe(true);
    expect(Object.isFrozen(result.value.commits[0]?.dependsOn)).toBe(true);
  });

  it.each([
    [
      "missing",
      validYaml.replace("workspace:\n  initialMain: commit-a\n", ""),
      "schema.invalid",
    ],
    [
      "unknown",
      replace("initialMain: commit-a", "initialMain: missing"),
      "workspace.initial-main-not-found",
    ],
  ])("rejects %s workspace.initialMain", (_name, source, code) => {
    const result = parseScenario(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code, path: ["workspace", "initialMain"] }),
    );
  });

  it.each([
    ["syntax", "metadata: [", "yaml.syntax"],
    [
      "unsupported version",
      replace("schemaVersion: 1", "schemaVersion: 2"),
      "schema.unsupported-version",
    ],
    [
      "duplicate ticket",
      replace("  - id: TEA-102", "  - id: TEA-101"),
      "ticket.duplicate-id",
    ],
    [
      "duplicate commit",
      replace("  - id: commit-a", "  - id: commit-b"),
      "commit.duplicate-id",
    ],
    [
      "duplicate ticket status",
      replace("  - id: done", "  - id: ready"),
      "ticket-status.duplicate-id",
    ],
    [
      "missing ticket status",
      replace("status: ready", "status: missing"),
      "ticket.status-not-found",
    ],
    [
      "missing ticket reference",
      replace("ticket: TEA-102", "ticket: TEA-999"),
      "commit.ticket-not-found",
    ],
    [
      "missing dependency",
      replace("dependsOn: [commit-a]", "dependsOn: [missing]"),
      "commit.dependency-not-found",
    ],
    [
      "cycle",
      replace("dependsOn: []", "dependsOn: [commit-b]"),
      "commit.dependency-cycle",
    ],
    [
      "invalid baseline",
      replace("baseline: commit-a", "baseline: missing"),
      "release.baseline-not-found",
    ],
    [
      "invalid scope",
      replace("tickets: [TEA-101]", "tickets: [missing]"),
      "release.ticket-not-found",
    ],
    [
      "unsafe check",
      replace("command: rg", "command: 'rg; rm'"),
      "check.unsafe-command",
    ],
    [
      "duplicate check",
      replace("id: tests", "id: typecheck"),
      "check.duplicate-id",
    ],
    [
      "invalid hint tier",
      replace("  - tier: 2", "  - tier: 1"),
      "hint.invalid-tier",
    ],
    [
      "negative score",
      replace("ticketSelection: 40", "ticketSelection: -1"),
      "scoring.negative-weight",
    ],
    [
      "wrong score total",
      replace("ticketSelection: 40", "ticketSelection: 39"),
      "scoring.invalid-total",
    ],
  ])("rejects %s with a stable diagnostic", (_name, source, code) => {
    const result = parseScenario(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const matching = result.diagnostics.find((item) => item.code === code);
    expect(matching).toBeDefined();
    expect(matching?.message.length).toBeGreaterThan(0);
    expect(Array.isArray(matching?.path)).toBe(true);
  });

  it("aggregates independently actionable structural failures", () => {
    const result = parseScenario(
      `schemaVersion: 1\nmetadata: {}\nseed: nope\n`,
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.length).toBeGreaterThan(2);
    expect(result.diagnostics.map(({ path }) => path)).toContainEqual(["seed"]);
    expect(result.diagnostics.map(({ path }) => path)).toContainEqual([
      "metadata",
      "id",
    ]);
  });

  it("aggregates safe semantic diagnostics with structural diagnostics", () => {
    const source = replace(
      "  description: Practice selecting different acceptance and production releases.\n",
      "",
    ).replace("status: ready", "status: missing");
    const result = parseScenario(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["schema.invalid", "ticket.status-not-found"]),
    );
  });

  it("rejects behavior check IDs duplicated across required and forbidden lists", () => {
    const result = parseScenario(replace("id: no-debug-log", "id: typecheck"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toContainEqual({
      code: "check.duplicate-id",
      message: "Duplicate identifier 'typecheck'.",
      path: ["checks", "forbidden", 0, "id"],
    });
  });

  it("rejects incomplete check definitions structurally", () => {
    const result = parseScenario(replace("      args: [typecheck]\n", ""));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "schema.invalid",
          path: ["checks", "required", 0, "args"],
        }),
      ]),
    );
  });
});
