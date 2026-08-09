# CLI contract

Release Mango supports Node.js 22+, Git 2.39+, Linux, and macOS.

## Commands

```text
releasemango [--json] new tutorial-01 [path] [--seed <integer>] [--overwrite]
releasemango [--json] brief
releasemango [--json] status
releasemango [--json] hint
releasemango [--json] evaluate acceptance|production
releasemango --version
```

`new` defaults to `./tutorial-01`. `--seed` makes generation reproducible.
`--overwrite` only replaces a workspace whose version-2 ownership metadata and
generated refs match the requested tutorial. Workspace commands walk upward from
the current directory to discover that ownership marker.

Human success is written to stdout and human diagnostics to stderr. With
`--json`, a command writes exactly one newline-terminated JSON document to
stdout and leaves stderr empty for expected diagnostics. Brief/status retain the
inspection envelope v1, hints retain hint JSON v1, and evaluations retain report
JSON v1.

Generation success is
`{"schemaVersion":1,"command":"new","ok":true,"destination":"…","nextAction":"…"}`.
CLI diagnostics are
`{"schemaVersion":1,"command":"…","ok":false,"diagnostics":[{"code":"…","message":"…"}]}`.
Diagnostics are bounded and omit stack traces, hashes, judging assets, secrets,
and solution details.

## Exit codes

| Code | Meaning                                        |
| ---: | ---------------------------------------------- |
|    0 | command success or passing evaluation          |
|    1 | completed learner evaluation that did not pass |
|    2 | usage or input error                           |
|    3 | infrastructure error or timeout                |
|  130 | SIGINT cancellation after cleanup              |

SIGINT is routed through the evaluator abort signal; evaluator subprocess and
temporary-worktree cleanup completes before the process returns 130. The
authoritative evaluator timeout is 20 seconds per behavior check and cannot be
extended by CLI input.

## Verification

```sh
pnpm build && pnpm vitest run tests/cli/commands.test.ts
pnpm verify
```
