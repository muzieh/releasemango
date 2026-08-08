# Hint JSON version 1

Hint selection is deterministic from the parsed scenario, public workspace
status, optional latest coaching report, and the workspace-wide `nextHintTier`
in `.git/releasemango/ownership-v1.json`.

Successful selected hints advance the counter once. `solved`, `exhausted`, and
system diagnostic results do not write. The counter is initialized to `1` by
workspace generation and is never inferred or reset from the current failure.

JSON is UTF-8, compact, and newline terminated. Keys are emitted in this order:

- Hint: `schemaVersion`, `state`, `tier`, `name`, `target`, `text`, `nextTier`.
- Solved or exhausted: `schemaVersion`, `state`, `nextTier`.

`schemaVersion` is `1`. `state` is `hint`, `solved`, or `exhausted`. A hint
target is either `null` (no report) or an object ordered as `release`,
`category`, `check`, `ticket`. Report targeting chooses the first non-passing
check in existing group/check order. Variant precedence is check, ticket,
category, release, then fallback.

Metadata read, parse, version/identity, and atomic replacement failures return
stable `hint.metadata-*` diagnostics and no partial file. The operation changes
no player commit, ref, index entry, tracked file, or worktree file.
