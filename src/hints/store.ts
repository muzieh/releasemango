import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OWNERSHIP_MANIFEST_PATH } from "../generator/index.js";
import type { HintRequest, HintResult, HintResponse } from "./model.js";
import { freezeDeep } from "./model.js";
import { selectHint } from "./select.js";

const failure = (code: string, message: string): HintResult<HintResponse> =>
  freezeDeep({ ok: false, diagnostics: [{ code, message }] });
export const requestHint = async (
  request: HintRequest,
): Promise<HintResult<HintResponse>> => {
  const path = join(request.repository, OWNERSHIP_MANIFEST_PATH);
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch {
    return failure(
      "hint.metadata-missing",
      "Release Mango ownership metadata is missing.",
    );
  }
  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(source) as Record<string, unknown>;
  } catch {
    return failure(
      "hint.metadata-malformed",
      "Release Mango ownership metadata is malformed.",
    );
  }
  if (
    manifest.schemaVersion !== 2 ||
    manifest.scenarioId !== request.scenario.metadata.id ||
    !Number.isSafeInteger(manifest.nextHintTier) ||
    (manifest.nextHintTier as number) < 1
  )
    return failure(
      "hint.metadata-unsupported",
      "Release Mango hint metadata is unsupported.",
    );
  const response = selectHint({
    ...request,
    nextTier: manifest.nextHintTier as number,
  });
  if (response.state !== "hint")
    return freezeDeep({ ok: true, value: response });
  const updated = { ...manifest, nextHintTier: response.nextTier };
  const temporary = `${path}.tmp-${process.pid.toString()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(updated, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await rename(temporary, path);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
    return failure(
      "hint.metadata-write-failed",
      "Release Mango hint metadata could not be updated.",
    );
  }
  return freezeDeep({ ok: true, value: response });
};
