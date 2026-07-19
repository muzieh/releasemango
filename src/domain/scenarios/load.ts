import { readFile } from "node:fs/promises";

import type { ScenarioDefinition, ScenarioResult } from "./model.js";
import { parseScenario } from "./parse.js";

export type ScenarioReader = (
  path: string,
  encoding: "utf8",
) => Promise<string>;

export const loadScenario = async (
  path: string,
  reader: ScenarioReader = readFile,
): Promise<ScenarioResult<ScenarioDefinition>> => {
  try {
    return parseScenario(await reader(path, "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      diagnostics: [
        {
          code: "path.read-failed",
          message: `Unable to read scenario from ${path}: ${reason}`,
          path: [],
        },
      ],
    };
  }
};
