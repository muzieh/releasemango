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
  `baseline`, a non-empty list of existing ticket IDs, and authored-order
  `requiredChecks` and `forbiddenChecks` ID arrays. Every check ID must name a
  global check, may occur only once per release, and cannot occur in both arrays
  for the same release. The two releases may declare different sets. These
  arrays are the sole source of check applicability; tickets, statuses, commits,
  and the other release never imply applicability.
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

Commit, global check, release check-reference, and hint arrays retain YAML
order. Evaluation runs each release's required references followed by its
forbidden references. A successful parse returns a deeply frozen model,
including nested objects and arrays.

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
- `release.baseline-not-found`, `release.ticket-not-found`,
  `release.check-not-found`, `release.duplicate-check`, and
  `release.contradictory-check`;
- `check.duplicate-id` and `check.unsafe-command`;
- `hint.invalid-tier`;
- `scoring.negative-weight` and `scoring.invalid-total`;
- `path.read-failed` for loader I/O failures.

YAML syntax failures use the parser's readable message and the most specific
path available (the root when malformed syntax prevents a reliable property
path).
