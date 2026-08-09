# Tutorial 01 curriculum asset

The canonical scenario is
[`scenarios/tutorial-01.yml`](../scenarios/tutorial-01.yml). It teaches release
assembly from a named baseline, complete multi-commit and dependent work,
exclusion of unfinished work, and semantic conflict resolution across distinct
acceptance and production targets.

The deterministic reference workflows live only under `tests/support/` and are
exercised by `tests/integration/tutorial-01-reference.test.ts`. They are private
test assets: the generator does not copy them, their implementation is not part
of learner metadata or hints, and generated repositories contain only fixture
application files and Release Mango ownership metadata. The black-box journey
under `tests/journey/` independently drives the built CLI and ordinary Git from
two fresh, isolated workspaces.

Run the focused journey before the full repository gate:

```sh
pnpm build && pnpm vitest run tests/journey/tutorial-01.test.ts
pnpm verify
```
