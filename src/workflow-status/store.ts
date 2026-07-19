import {
  mkdir,
  readFile,
  rename,
  writeFile,
  appendFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  emptySnapshot,
  statusEventSchema,
  type StatusEvent,
  type StatusSnapshot,
} from "./schema.js";

export class WorkflowStatusStore {
  readonly #snapshotPath: string;
  readonly #eventsPath: string;
  #snapshot = emptySnapshot();

  constructor(readonly directory: string) {
    this.#snapshotPath = join(directory, "snapshot.json");
    this.#eventsPath = join(directory, "events.jsonl");
  }

  async initialize(): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    try {
      this.#snapshot = JSON.parse(
        await readFile(this.#snapshotPath, "utf8"),
      ) as StatusSnapshot;
    } catch (error: unknown) {
      if (!isMissingFile(error)) throw error;
    }
  }

  getSnapshot(): StatusSnapshot {
    return structuredClone(this.#snapshot);
  }

  async apply(input: unknown): Promise<StatusSnapshot> {
    const event = statusEventSchema.parse(input);
    const timestamp = event.timestamp ?? new Date().toISOString();
    this.#snapshot = reduceSnapshot(this.#snapshot, event, timestamp);
    await appendFile(
      this.#eventsPath,
      `${JSON.stringify({ ...event, timestamp })}\n`,
      "utf8",
    );
    await this.#writeSnapshot();
    return this.getSnapshot();
  }

  async #writeSnapshot(): Promise<void> {
    const temporaryPath = `${this.#snapshotPath}.${String(process.pid)}.tmp`;
    await mkdir(dirname(temporaryPath), { recursive: true });
    await writeFile(
      temporaryPath,
      `${JSON.stringify(this.#snapshot, null, 2)}\n`,
    );
    await rename(temporaryPath, this.#snapshotPath);
  }
}

function reduceSnapshot(
  previous: StatusSnapshot,
  event: StatusEvent,
  timestamp: string,
): StatusSnapshot {
  if (event.type === "workflow.reset") return emptySnapshot();

  const agents = [...previous.agents];
  let workflow = previous.workflow;
  if (event.type === "agent.upsert") {
    const index = agents.findIndex(({ id }) => id === event.agent.id);
    const agent = { ...event.agent, updatedAt: timestamp };
    if (index === -1) agents.push(agent);
    else agents[index] = agent;
  } else {
    workflow = { ...event.workflow, updatedAt: timestamp };
  }

  agents.sort((left, right) => left.name.localeCompare(right.name));
  return {
    schemaVersion: 1,
    updatedAt: timestamp,
    workflow,
    agents,
    summary: {
      total: agents.length,
      running: agents.filter(({ status }) => status === "running").length,
      blocked: agents.filter(({ status }) => status === "blocked").length,
      completed: agents.filter(({ status }) => status === "completed").length,
    },
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
