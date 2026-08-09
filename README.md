# Release Mango

Release Mango provides a deterministic release-engineering tutorial CLI. Use
`releasemango new tutorial-01` to create an exercise, then run `brief`,
`status`, `hint`, and `evaluate acceptance|production` from anywhere inside the
generated workspace. See [the CLI contract](docs/cli.md) for options,
machine-readable output, safety behavior, and exit codes.

The built CLI composes deterministic generation, Git-backed inspection,
progressive hints, isolated release evaluation, and coaching reports.

## Prerequisites

- Node.js 22 or newer
- pnpm 10.18.0
- Git 2.39 or newer
- Linux or macOS (Windows support is deferred)

## Install and verify

Install exactly the dependency graph committed in `pnpm-lock.yaml`:

```sh
pnpm install --frozen-lockfile
```

Run every local quality gate:

```sh
pnpm verify
```

`pnpm verify` fails at the first unsuccessful gate and runs the same sequence as
pull-request CI: formatting, linting, typechecking, tests, and build.

To reproduce CI from a clean checkout:

```sh
git clean -ndx
pnpm install --frozen-lockfile
pnpm verify
```

The first command is a non-destructive preview of untracked and ignored files;
remove or relocate any reported local artifacts before running the install and
verification commands when a truly clean checkout is required.

After building, print the package version:

```sh
node dist/cli/index.js --version
```

## Contributing

Work test-first: add the smallest focused test, run it and confirm the expected
failure (red), implement only enough behavior to pass (green), then refactor
while keeping the test green. Run all quality gates before submitting a change.
Tests that need a workspace must use an isolated OS temporary directory and
clean it up; never generate a player workspace inside this source tree. Git
integration tests must also isolate `HOME`, XDG and Git global/system config,
pass deterministic identity and timestamps explicitly, avoid ambient templates,
and use only local repositories. Automated tests must not require network
access; exercise network-facing behavior through injected or fake boundaries.

Architectural decisions and constraints are recorded in
[`docs/adr/0001-mvp-architecture.md`](docs/adr/0001-mvp-architecture.md). The
canonical first curriculum scenario is documented in
[`docs/tutorial-01.md`](docs/tutorial-01.md).
