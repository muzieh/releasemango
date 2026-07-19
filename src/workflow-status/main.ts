import { resolve } from "node:path";
import { createStatusServer } from "./server.js";
import { WorkflowStatusStore } from "./store.js";

const host = process.env.WORKFLOW_STATUS_HOST ?? "127.0.0.1";
const port = Number(process.env.WORKFLOW_STATUS_PORT ?? "4173");
const stateDirectory = resolve(
  process.env.WORKFLOW_STATUS_DIR ?? ".workflow-status",
);
const store = new WorkflowStatusStore(stateDirectory);
await store.initialize();

const server = createStatusServer(store, {
  host,
  port,
  publicDirectory: resolve("public/workflow-status"),
  ...(process.env.WORKFLOW_STATUS_TOKEN === undefined
    ? {}
    : { token: process.env.WORKFLOW_STATUS_TOKEN }),
});

server.listen(port, host, () => {
  process.stdout.write(`Workflow dashboard: http://${host}:${String(port)}\n`);
  process.stdout.write(`State directory: ${stateDirectory}\n`);
});
