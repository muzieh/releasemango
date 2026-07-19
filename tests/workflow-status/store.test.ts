import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { WorkflowStatusStore } from "../../src/workflow-status/store.js";
import { withTemporaryDirectory } from "../support/temporary-directory.js";

describe("WorkflowStatusStore", () => {
  it("persists provider-neutral events and derives agent counts", async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new WorkflowStatusStore(directory);
      await store.initialize();
      await store.apply({
        type: "workflow.upsert",
        timestamp: "2026-07-19T10:00:00.000Z",
        workflow: {
          id: "delivery",
          title: "Deliver MVP",
          status: "running",
          currentItem: "TEA-5",
          stage: "refine",
        },
      });
      const snapshot = await store.apply({
        type: "agent.upsert",
        timestamp: "2026-07-19T10:01:00.000Z",
        agent: {
          id: "worker-1",
          name: "Refiner",
          provider: "codex",
          status: "running",
          item: "TEA-5",
          stage: "refine",
        },
      });

      expect(snapshot.summary).toEqual({
        total: 1,
        running: 1,
        blocked: 0,
        completed: 0,
      });
      expect(snapshot.workflow?.currentItem).toBe("TEA-5");
      expect(
        (await readFile(`${directory}/events.jsonl`, "utf8"))
          .trim()
          .split("\n"),
      ).toHaveLength(2);

      const restored = new WorkflowStatusStore(directory);
      await restored.initialize();
      expect(restored.getSnapshot()).toEqual(snapshot);
    });
  });

  it("rejects invalid event states", async () => {
    await withTemporaryDirectory(async (directory) => {
      const store = new WorkflowStatusStore(directory);
      await store.initialize();
      await expect(
        store.apply({
          type: "agent.upsert",
          agent: { id: "a", status: "mystery" },
        }),
      ).rejects.toThrow();
    });
  });
});
