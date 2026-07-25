import { describe, expect, it, vi } from "vitest";

import { loadScenario } from "../../../src/domain/scenarios/index.js";

describe("loadScenario", () => {
  it("reads exactly the caller-supplied path and delegates parsing", async () => {
    const read = vi.fn(() => Promise.resolve("schemaVersion: 2"));
    const result = await loadScenario("/chosen/scenario.yaml", read);
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith("/chosen/scenario.yaml", "utf8");
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.diagnostics[0]?.code).toBe("schema.unsupported-version");
  });

  it("returns a structured diagnostic when the path cannot be read", async () => {
    const result = await loadScenario("/missing.yaml", () =>
      Promise.reject(new Error("ENOENT")),
    );
    expect(result).toEqual({
      ok: false,
      diagnostics: [
        {
          code: "path.read-failed",
          message: "Unable to read scenario from /missing.yaml: ENOENT",
          path: [],
        },
      ],
    });
  });
});
