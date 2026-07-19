---
name: plan-ticket
description: Independently validate a refined Release Mango Linear issue and prepare a repository-specific development plan. Use after refinement and before implementation, or when a ticket needs a second Definition of Ready check and an executable test-first plan.
---

# Plan a ticket

Read `../../../CLAUDE.md`, the Linear issue, `<primary-checkout>/.sdlc/active/<issue>/brief.md`, dependency issues, and relevant repository files. Resolve the primary checkout with `git worktree list --porcelain`. Do not implement code and do not use Maister.

1. Independently rerun Definition of Ready. Do not trust the prior verdict without evidence.
2. If readiness fails, write the gaps to `plan.md`, add a concise Linear comment, and return the issue to refinement.
3. If it passes, write `<primary-checkout>/.sdlc/active/<issue>/plan.md` containing (and never commit it):
   - issue ID and current revision/update timestamp;
   - files/modules expected to change and why;
   - ordered red, green, and refactor steps;
   - exact focused and full verification commands;
   - compatibility, safety, and migration concerns;
   - explicit non-goals;
   - a checklist mapping every acceptance criterion to a test or inspection.
4. Prefer the smallest vertical change. Flag any architecture decision that requires an ADR.
5. Add only a short Linear comment with `Plan: pass|fail`, assumptions, risk summary, and the artifact path. Do not paste the plan into Linear.

The plan is a handoff, not a transcript; keep it below 200 lines and replace stale content.
