import {
  deepFreeze,
  type InspectionCommand,
  type InspectionResult,
} from "./model.js";

export function jsonEnvelope<T>(
  command: InspectionCommand,
  result: InspectionResult<T>,
): object {
  return deepFreeze(
    result.ok
      ? { schemaVersion: 1, command, ok: true, payload: result.value }
      : {
          schemaVersion: 1,
          command,
          ok: false,
          diagnostics: result.diagnostics,
        },
  );
}
export function renderJson<T>(
  command: InspectionCommand,
  result: InspectionResult<T>,
): string {
  return JSON.stringify(jsonEnvelope(command, result));
}
