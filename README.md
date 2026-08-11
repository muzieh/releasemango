# Release Mango

Release Mango is a local Git release-engineering tutorial. Version 0.1.0
contains the canonical `tutorial-01` journey.

## Prerequisites and installation

Use Node.js 22 or newer and Git 2.39 or newer on Linux or macOS. Repository
development uses pnpm 10.18.0. From a directory containing the locally built
candidate:

```sh
pnpm add --offline ./releasemango-0.1.0.tgz
./node_modules/.bin/releasemango --version
```

The package and CLI require no network access at runtime.

## The learner loop

Choose a new, empty destination that you own, then run the five-command loop:

```sh
releasemango new tutorial-01 ./my-tutorial
cd ./my-tutorial
releasemango brief
releasemango status
releasemango evaluate acceptance
releasemango evaluate production
```

Between CLI commands, use ordinary Git commands (`git switch`,
`git cherry-pick`, `git merge`, `git add`, and `git commit`) to assemble the
requested release branches. If you get stuck, `releasemango hint` gives an
optional progressive hint.

Remove only the workspace path you explicitly created and have verified, for
example `rm -rf -- ./my-tutorial` from its parent after leaving the directory.
Never point cleanup at a broad, empty, or unverified path.

## JSON automation contracts

Pass `--json` for machine-readable output. The versioned contracts are
[CLI behavior](https://github.com/muzieh/releasemango/blob/main/docs/cli.md),
[report JSON v1](https://github.com/muzieh/releasemango/blob/main/docs/report-json-v1.md),
and
[hint JSON v1](https://github.com/muzieh/releasemango/blob/main/docs/hint-json-v1.md).

## Privacy and safety

Release Mango performs local filesystem, Git, and bounded child-process work. It
has no telemetry and requires no network access. Inspection, hints, and
evaluation do not change the learner's current branch, index, or tracked
worktree. Evaluation uses temporary Git worktrees and removes them on
completion. Diagnostics are bounded and avoid exposing private judging
implementation details; temporary staging, backup, and evaluation artifacts are
cleaned on success, failure, timeout, or interruption.

## Troubleshooting

- **Unsupported Node or Git:** check `node --version` (22+) and `git --version`
  (2.39+) before retrying.
- **Destination rejected:** `new` requires a missing or empty destination owned
  by the current user. Choose a fresh path; do not delete unknown contents.
- **Missing branches or refs:** run `git show-ref` and `releasemango status`;
  create the requested release branch from the scenario's named baseline and use
  the generated `refs/releasemango/*` refs.
- **Merge or cherry-pick conflict:** inspect `git status`, resolve the
  learner-created conflicts, stage the resolution, and continue the operation.
  Abort it with the matching Git command if you want to start over.
- **Exit 3:** evaluation timed out or encountered infrastructure trouble. Read
  stderr, confirm required tools and refs, and retry after correcting the
  environment.
- **Exit 130:** the command was interrupted. Confirm no Git operation is still
  active, inspect `git worktree list`, and retry; Release Mango attempts bounded
  cleanup before exiting.

## Known limitations

The MVP supports Linux and macOS, one scenario, and command-line interaction.
Windows, a TUI, additional scenarios, a `solution` command, and agent-specific
skills are not included.

Contributors can reproduce all gates and the clean-consumer proof with the
[release-candidate checklist](https://github.com/muzieh/releasemango/blob/main/docs/release-candidate-checklist.md).
