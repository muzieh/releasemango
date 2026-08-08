# Report JSON contract version 1

`serializeReportJson` emits one newline-terminated JSON object with keys in the
documented order: `schemaVersion`, `release`, `score`, `verdict`, `severity`,
`groups`, and `nextAction`. Repeated serialization of the same immutable report
is byte-identical.

- `schemaVersion` is `1`. Breaking contract changes require a new version.
- `release` contains `branch`, `baseline`, and the ordered `tickets` scope.
- `score` is an integer from 0 through 100 for completed learner outcomes and
  `null` for infrastructure errors and cancellation.
- `verdict` is `pass`, `fail`, `error`, or `cancelled`; `severity` is `none`,
  `warning`, `blocking`, or `system`.
- `groups` preserve evaluator category and check order. Every check includes its
  stable `id`, `status`, and bounded `evidence`. Volatile durations are omitted.
- `nextAction` is `null` on pass and otherwise one bounded, deterministic,
  non-spoiling public action.

Human output is presentation only and consumes the same report model.
