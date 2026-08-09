import { readFile, realpath } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { OWNERSHIP_MANIFEST_PATH } from "../generator/index.js";

export type WorkspaceLookup =
  | { readonly ok: true; readonly root: string }
  | { readonly ok: false; readonly code: string; readonly message: string };

export async function findWorkspace(start: string): Promise<WorkspaceLookup> {
  let current: string;
  try {
    current = await realpath(start);
  } catch {
    return {
      ok: false,
      code: "WORKSPACE_NOT_FOUND",
      message: "No Release Mango workspace was found.",
    };
  }
  const filesystemRoot = parse(current).root;
  for (;;) {
    try {
      const value: unknown = JSON.parse(
        await readFile(join(current, OWNERSHIP_MANIFEST_PATH), "utf8"),
      );
      if (value === null || typeof value !== "object")
        throw new Error("invalid");
      const manifest = value as Record<string, unknown>;
      if (manifest.schemaVersion !== 2)
        return {
          ok: false,
          code: "OWNERSHIP_VERSION_UNSUPPORTED",
          message: "The workspace ownership version is unsupported.",
        };
      if (manifest.scenarioId !== "tutorial-01")
        return {
          ok: false,
          code: "SCENARIO_UNSUPPORTED",
          message: "The workspace scenario is unsupported.",
        };
      return { ok: true, root: current };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        return {
          ok: false,
          code: "OWNERSHIP_MANIFEST_INVALID",
          message: "The workspace ownership manifest is invalid.",
        };
    }
    if (current === filesystemRoot) break;
    current = dirname(current);
  }
  return {
    ok: false,
    code: "WORKSPACE_NOT_FOUND",
    message: "No Release Mango workspace was found.",
  };
}
