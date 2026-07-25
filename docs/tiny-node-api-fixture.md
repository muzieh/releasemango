# Tiny Node API fixture

This fixture is stable source material for generated tutorial repositories. Its
application uses only Node built-ins, listens on an ephemeral loopback port, and
emits one readiness line: `{"event":"ready","port":<number>}`. Consumers copy
`baseline/` then overlay each state's ordered units from `changes/`, using only
the files declared in `states.json`.

The learner-inspection target is roughly 200 lines or fewer of baseline
application source. Authored change assets are intentionally small and excluded
from that target. State IDs, unit names, dependencies, and public responses are
compatibility inputs for TEA-8 and TEA-14.

## State matrix

| State                           | Ordered units                                     | Expected public observation                                                 |
| ------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------- |
| `baseline`                      | —                                                 | `/health` → 200 `{"status":"ok"}`                                           |
| `single-greeting`               | `single-greeting`                                 | `/greeting` → 200 `{"greeting":"hello"}`                                    |
| `multi-route-only`              | `multi-route`                                     | Startup exits non-zero because the implementation unit is absent            |
| `multi-complete`                | `multi-route`, `multi-implementation`             | `/multi` → 200 with `feature: "complete"` and `units: 2`                    |
| `dependent-without-json-helper` | `dependent-feature`                               | Startup exits non-zero because `json-helper` is absent                      |
| `dependent-complete`            | `json-helper`, `dependent-feature`                | `/shared` → 200 with the wrapped dependent result                           |
| `forbidden-debug`               | `forbidden-debug`                                 | `/debug` → 200, demonstrating that the no-debug check fails                 |
| `acceptance`                    | `acceptance`                                      | `/readiness` includes acceptance-only `detail: "candidate"`; `/debug` → 404 |
| `production`                    | `production`                                      | `/readiness` identifies production and omits `detail`; `/debug` → 404       |
| `semantic-a`                    | `semantic-a`                                      | `/policy` → 200 with `audience: "internal"`                                 |
| `semantic-b`                    | `semantic-b`                                      | `/policy` → 200 with `cache: "private"`                                     |
| `semantic-resolution`           | `semantic-a`, `semantic-b`, `semantic-resolution` | `/policy` preserves both `audience` and `cache`                             |

`multi-implementation` requires `multi-route`; `dependent-feature` requires
`json-helper`; and `semantic-resolution` requires both semantic units.
Acceptance and production exclude `forbidden-debug`.

## Trusted judging bundle

`judging/` is external generator source and is never copied into the player's
tracked tree. The ownership manifest records the bundle directory identity and a
deterministic SHA-256 fingerprint of all names and bytes. Acceptance evaluation
resolves available relative check assets against this directory, rejects
symlinks and path escapes, and fails before executing a check when the bundle is
missing or its fingerprint differs.

## Representation contract

- Baseline and every state are copied into a fresh OS temporary directory.
- Unit file paths are relative and must remain inside the materialized root.
- Observable checks use HTTP responses, startup exit status, stdout, or stderr
  only.
- Assets contain no Git identities, history, hashes, timestamps, absolute paths,
  fixed ports, or developer configuration.
- State behavior is deterministic; process timeouts are only bounded
  coordination.

Run the focused verification twice:

```sh
pnpm vitest run tests/fixtures/tiny-node-api
pnpm vitest run tests/fixtures/tiny-node-api
```
