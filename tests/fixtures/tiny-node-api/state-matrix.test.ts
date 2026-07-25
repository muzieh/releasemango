import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  fixtureFingerprint,
  loadManifest,
  materialize,
  remove,
  request,
  start,
  stop,
  type State,
} from "./support.js";

describe("tiny Node API fixture", () => {
  it("defines the complete deterministic state matrix", async () => {
    const manifest = await loadManifest();

    expect(Object.keys(manifest.states)).toEqual([
      "baseline",
      "single-greeting",
      "multi-route-only",
      "multi-complete",
      "dependent-without-json-helper",
      "dependent-complete",
      "forbidden-debug",
      "acceptance",
      "production",
      "semantic-a",
      "semantic-b",
      "semantic-resolution",
    ]);
  });

  it("rejects an escaping overlay path and cleans its temporary directory", async () => {
    const parent = await mkdtemp(join(tmpdir(), "tiny-node-api-boundary-"));
    try {
      await expect(
        materialize(
          ["escape"],
          {
            units: {
              escape: { requires: [], files: ["../outside.mjs"] },
            },
            states: {},
          },
          parent,
        ),
      ).rejects.toThrow("unsafe overlay file");
      expect(await readdir(parent)).toEqual([]);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  const publicChecks: Record<
    string,
    { path: string; status: number; body: unknown }
  > = {
    health: { path: "/health", status: 200, body: { status: "ok" } },
    greeting: {
      path: "/greeting",
      status: 200,
      body: { greeting: "hello" },
    },
    multi: {
      path: "/multi",
      status: 200,
      body: { feature: "complete", units: 2 },
    },
    shared: {
      path: "/shared",
      status: 200,
      body: { data: { feature: "dependent" } },
    },
    acceptance: {
      path: "/readiness",
      status: 200,
      body: { ready: true, environment: "acceptance", detail: "candidate" },
    },
    production: {
      path: "/readiness",
      status: 200,
      body: { ready: true, environment: "production" },
    },
    "semantic-a": {
      path: "/policy",
      status: 200,
      body: { audience: "internal" },
    },
    "semantic-b": {
      path: "/policy",
      status: 200,
      body: { cache: "private" },
    },
    "semantic-resolution": {
      path: "/policy",
      status: 200,
      body: { audience: "internal", cache: "private" },
    },
    "no-debug": {
      path: "/debug",
      status: 404,
      body: { error: "not_found" },
    },
  };

  async function observe(state: State): Promise<void> {
    const root = await materialize(state.units);
    try {
      if (state.expect === "startup-failure") {
        await expect(start(root)).rejects.toThrow(/ERR_MODULE_NOT_FOUND/);
        return;
      }
      const running = await start(root);
      try {
        if (state.expect === "negative-check-failure") {
          expect(await request(running.port, "/debug")).toEqual({
            status: 200,
            body: { secrets: "exposed" },
          });
          return;
        }
        for (const checkName of state.checks) {
          const check = publicChecks[checkName];
          if (check !== undefined) {
            expect(await request(running.port, check.path)).toEqual({
              status: check.status,
              body: check.body,
            });
          }
        }
      } finally {
        await stop(running.child);
      }
    } finally {
      await remove(root);
    }
  }

  it("observes every state from a fresh temporary directory", async () => {
    const before = await fixtureFingerprint();
    const manifest = await loadManifest();
    for (const state of Object.values(manifest.states)) await observe(state);
    expect(await fixtureFingerprint()).toBe(before);
  }, 20_000);
});
