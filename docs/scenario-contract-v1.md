# Scenario contract version 1

Release Mango scenarios are UTF-8 YAML documents with an exact
`schemaVersion: 1`. Unknown versions are rejected, not coerced. The public
parser is pure; `loadScenario` is the only filesystem boundary and reads only
the path supplied by its caller.

The canonical minimal example is
[`tests/fixtures/scenarios/minimal-v1.yaml`](../tests/fixtures/scenarios/minimal-v1.yaml).

## Fields

- `metadata`: non-empty `id`, learner-facing `title`, and `description`.
- `seed`: a non-negative integer used by later deterministic generation.
- `workspace.initialMain`: required authored commit ID used as the exact
  generated `main` tip. It is never inferred from ticket or release state.
- `ticketStatuses`: status `id` and display `name` entries. IDs are unique.
- `tickets`: unique `id`, `title`, and a `status` referencing `ticketStatuses`.
- `commits`: authored-order commit definitions with unique `id`, ticket
  reference, message, and `dependsOn` commit IDs. Dependencies must exist and be
  acyclic.
- `releases.acceptance` and `releases.production`: each names an existing commit
  `baseline` and a non-empty list of existing ticket IDs. Their baselines and
  scopes are independent and may differ.
- `checks.required` and `checks.forbidden`: authored-order declarative checks
  with a unique non-empty `id`, a single executable `command`, and an explicit
  `args` array. Commands may contain letters, digits, `_`, `.`, `/`, and `-`;
  arguments may not contain NUL or line breaks. Checks are data and are not
  executed by this module.
- `hints`: authored-order tiers with non-empty text. Tiers must be the
  contiguous, unique sequence `1, 2, ...`.
- `scoring`: named numeric weights. Each weight is non-negative and all weights
  must total exactly 100. This contract validates weights but does not calculate
  scores.

## Ordering and immutability

Commit, required-check, forbidden-check, and hint arrays retain YAML order. A
successful parse returns a deeply frozen model, including nested objects and
arrays.

## Diagnostics

Failures return all independently discoverable diagnostics as
`{ code, message, path }`. Paths are YAML property/index segments. Stable code
families are:

- `yaml.syntax`, `schema.unsupported-version`, and `schema.invalid`;
- `ticket-status.duplicate-id`, `ticket.duplicate-id`, and
  `ticket.status-not-found`;
- `commit.duplicate-id`, `commit.ticket-not-found`,
  `commit.dependency-not-found`, and `commit.dependency-cycle`;
- `workspace.initial-main-not-found`;
- `release.baseline-not-found` and `release.ticket-not-found`;
- `check.duplicate-id` and `check.unsafe-command`;
- `hint.invalid-tier`;
- `scoring.negative-weight` and `scoring.invalid-total`;
- `path.read-failed` for loader I/O failures.

YAML syntax failures use the parser's readable message and the most specific
path available (the root when malformed syntax prevents a reliable property
path).
