import type { ScenarioDefinition } from "../domain/scenarios/index.js";
import {
  deepFreeze,
  type Brief,
  type BriefRelease,
  type InspectionResult,
} from "./model.js";

const release = (
  value: ScenarioDefinition["releases"]["acceptance"],
): BriefRelease => ({
  baseline: value.baseline,
  tickets: [...value.tickets],
  requiredChecks: [...value.requiredChecks],
  forbiddenChecks: [...value.forbiddenChecks],
});

export function createBrief(
  scenario: ScenarioDefinition,
): InspectionResult<Brief> {
  const version = (scenario as { schemaVersion?: unknown }).schemaVersion;
  if (version !== 1)
    return deepFreeze({
      ok: false,
      diagnostics: [
        {
          code: "SCENARIO_VERSION_UNSUPPORTED",
          message: `Scenario schema version ${String(version)} is unsupported.`,
        },
      ],
    });
  const statuses = new Map(
    scenario.ticketStatuses.map(({ id, name }) => [id, name]),
  );
  return deepFreeze({
    ok: true,
    value: {
      goal: scenario.metadata.description,
      tickets: scenario.tickets.map(({ id, title, status }) => ({
        id,
        title,
        status: statuses.get(status) ?? status,
      })),
      releases: {
        acceptance: release(scenario.releases.acceptance),
        production: release(scenario.releases.production),
      },
    },
  });
}
