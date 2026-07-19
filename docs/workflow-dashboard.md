# Workflow status dashboard

The local dashboard reports workflow and agent state without depending on Codex,
Claude, or another orchestrator's private APIs. Producers publish a common
event; the service keeps an append-only audit log plus an atomic derived
snapshot.

## Run

```bash
pnpm dashboard
```

Open <http://127.0.0.1:4173>. Runtime data is stored in the ignored
`.workflow-status/` directory. Configure `WORKFLOW_STATUS_HOST`,
`WORKFLOW_STATUS_PORT`, `WORKFLOW_STATUS_DIR`, or `WORKFLOW_STATUS_TOKEN` as
needed. The default loopback binding is intentionally local-only.

## Publish state

```bash
curl -X POST http://127.0.0.1:4173/api/events \
  -H 'content-type: application/json' \
  -d '{"type":"workflow.upsert","workflow":{"id":"release-mango","title":"Release Mango SDLC","status":"running","currentItem":"TEA-5","stage":"refine"}}'

curl -X POST http://127.0.0.1:4173/api/events \
  -H 'content-type: application/json' \
  -d '{"type":"agent.upsert","agent":{"id":"refiner-1","name":"Refinement worker","provider":"codex","status":"running","item":"TEA-5","stage":"refine"}}'
```

When `WORKFLOW_STATUS_TOKEN` is set, include `Authorization: Bearer <token>` on
POST requests. Reads remain local and unauthenticated. Supported agent states
are `idle`, `running`, `waiting`, `blocked`, `completed`, `failed`, and
`interrupted`.

## Integration model

Orchestrators should emit `agent.upsert` when an agent starts, changes stage,
waits, blocks, fails, or completes. They should emit `workflow.upsert` at ticket
and gate transitions. The API is the stable integration boundary; Codex/Claude
hooks or polling adapters can translate provider-specific lifecycle events into
these events without changing the dashboard.
