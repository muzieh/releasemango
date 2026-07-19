# Release Mango

Release Mango is a release-engineering practice tool. This initial foundation
only provides a compiled command that reports the package version; scenarios,
generation, Git operations, evaluation, and reporting behavior arrive later.

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
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm format:check
```

After building, print the package version:

```sh
node dist/cli/index.js --version
```

## Contributing

Work test-first: add the smallest focused test, run it and confirm the expected
failure (red), implement only enough behavior to pass (green), then refactor
while keeping the test green. Run all quality gates before submitting a change.
Tests that need a workspace must use an isolated OS temporary directory and
clean it up; never generate a player workspace inside this source tree.

Architectural decisions and constraints are recorded in
[`docs/adr/0001-mvp-architecture.md`](docs/adr/0001-mvp-architecture.md).
