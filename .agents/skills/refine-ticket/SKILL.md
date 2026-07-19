---
name: refine-ticket
description: Perform gap analysis and Definition of Ready refinement for a Release Mango Linear issue. Use when an issue must be checked for clarity, made actionable, supplied with observable acceptance criteria, or returned to the SDLC planning gate.
---

# Refine a ticket

Read `../../../CLAUDE.md`. Load the Linear issue, project overview, dependencies, and relevant repository context. Do not implement code and do not use Maister.

1. Check outcome, user/system behavior, scope boundaries, dependency state, technical constraints, risks, acceptance criteria, red/green test intent, and verification commands.
2. Infer low-risk details from the project ADR/backlog. Ask the user only when an unresolved product choice would materially change the result.
3. Rewrite the Linear description in this compact order: Outcome, Context, Scope, Red/green test, Acceptance criteria, Out of scope, Assumptions.
4. Make every acceptance criterion independently observable and avoid implementation prescriptions unless architecture already fixes them.
5. Preserve valid original intent and existing links. Never remove blocking relations merely to make the issue appear ready.
6. Resolve the primary checkout with `git worktree list --porcelain` and write `<primary-checkout>/.sdlc/active/<issue>/brief.md` with issue URL, one-paragraph objective, dependencies, constraints, and a `DoR: pass|fail` line. Do not copy the full ticket or commit the artifact.
7. Add one short Linear comment: verdict, material refinements, unresolved questions, and the artifact path.

Return `ready` only if the Definition of Ready in `$sdlc` passes. Otherwise return `needs-decision` with the smallest concrete question.
