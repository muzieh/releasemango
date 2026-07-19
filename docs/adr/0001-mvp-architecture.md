# ADR 0001: MVP architecture

- Status: Accepted
- Date: 2026-07-19

## Context

Release Mango's MVP is a tutorial vertical slice that creates disposable player
repositories, runs Git operations, evaluates outcomes, and presents stable
results. The foundation must keep later domain work deterministic, testable, and
safe while remaining small enough for a clean-checkout contributor workflow.

## Decisions

The project uses Node.js 22, TypeScript 5.x in strict mode, native ECMAScript
modules, and pnpm with a committed lockfile. Linux and macOS are supported with
Git 2.39 or newer. Windows is deferred.

The command-line interface uses Commander. Git and other subprocesses use execa
only behind a typed process adapter. Domain logic receives clocks, paths, and
process adapters explicitly; it must not read hidden global state.

Versioned YAML scenario files are parsed with `yaml` and validated with Zod.
Vitest covers unit and integration behavior. Tests use isolated OS temporary
directories and clean them up without changing global Git configuration.

Generated player workspaces live outside the source tree and contain a marker
manifest so destructive operations can verify ownership. A generated workspace
must never be written into the Release Mango checkout.

Machine-readable JSON is a stable, versioned CLI contract. Human-readable output
is a presentation layer over that contract and may not redefine its semantics.

Source code is separated into CLI, domain/scenarios, generator, Git/process,
evaluator, and reporting boundaries. The MVP covers one end-to-end tutorial
flow; each boundary can evolve behind explicit interfaces.

## Alternatives considered

- npm and Yarn were considered, but pnpm provides a strict, efficient dependency
  graph and an enforceable frozen-lockfile workflow.
- CommonJS was considered, but native ESM matches modern Node.js and dependency
  ecosystems without dual-module complexity.
- Hand-written argument parsing was considered, but Commander provides a small,
  established CLI contract. Direct subprocess calls were rejected because a
  typed execa adapter is easier to fake and centralizes safety policy.
- JSON scenario files and unchecked YAML were considered. YAML is more suitable
  for authored tutorials, while Zod makes its runtime boundary explicit.
- Jest and repository-local fixture directories were considered. Vitest fits the
  TypeScript/ESM toolchain, and OS temporary directories prevent test or
  generated workspace state from contaminating the checkout.
- Ambient clocks, paths, and process globals were rejected because they make
  tests nondeterministic and conceal side effects.

## Consequences

Contributors need the stated Node, pnpm, and Git versions. Native ESM requires
explicit module-resolution discipline. Runtime schemas and injected adapters add
some structure, but failures occur at clear boundaries and tests remain
isolated. Marker manifests add a safety check before workspace mutation.
Versioned JSON requires compatibility care, while keeping human presentation
independently changeable.

## MVP scope and non-goals

The architecture supports a single tutorial vertical slice and its deterministic
generation, Git interaction, evaluation, and reports. This bootstrap implements
only version reporting.

This decision does not add scenario semantics, fixtures, repository generation,
Git adapter behavior, evaluation or scoring, release policy, terminal UI, CI,
publishing, solutions or hints, or agent skills. Cross-platform Windows
behavior, multiple tutorial tracks, and a general plugin system are not MVP
goals.
