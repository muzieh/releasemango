# Release Mango project instructions

## Project-local SDLC

Invoke `/sdlc` in Claude Code or `$sdlc` in Codex to deliver the next eligible Linear ticket. These instructions and the skills under `.agents/skills/` apply only to Release Mango. Do not use the Maister plugin in this project.

The workflow is Linear selection → refinement/Definition of Ready → independent plan gate → red/green/refactor implementation → GitHub pull request → independent code review → repair loop if needed → required checks → squash merge to `main` → Linear Done → worktree cleanup.

## Systems of record

- Linear project `Release Mango` (`474e38fa-d9a4-45ca-ba1f-730975fd3324`) owns requirements, acceptance criteria, dependencies, priority, and lifecycle state.
- GitHub repository `releasemango` owns branches, commits, CI, PR reviews, and merge history. Discover the actual remote URL from `git remote`; do not guess the owner. If no remote exists, stop before push/PR and ask the user to create or provide it.
- `<primary-checkout>/.sdlc/active/<issue>/` owns compact agent handoffs. Resolve the primary checkout with `git worktree list --porcelain`; all agents read and write that same location even while coding elsewhere. It is temporary operational state, not a replacement for Linear or GitHub.

## Agent and context policy

- Use at most three active agents total, including the orchestrator. Default to sequential specialist agents; only parallelize read-only work on different tickets when explicitly requested.
- Use separate agents/contexts for refinement, planning, coding, and review. The reviewer must not be the coder.
- Pass issue ID, repo/worktree path, PR URL, and artifact paths—not full transcripts or copied ticket bodies.
- Handoff files are local operational state and must not be committed or included in a pull request.
- Keep Linear comments under roughly 1,000 characters. Store durable scope in the issue description, code discussion in GitHub, and compact gate evidence in `.sdlc` files.
- Reread issue and PR state before mutations. Make retries idempotent and do not duplicate comments, branches, worktrees, or PRs.

## Git and GitHub policy

- Keep the primary checkout on `main` for orchestration only.
- Use one worktree per issue at `../releasemango-worktrees/<issue-lowercase>` and the Linear-provided branch name.
- Update `main` with a fast-forward-only pull before creating a worktree. Never reuse a worktree across tickets.
- Never force-push, bypass branch protection, merge with pending/failing checks, or merge unresolved review findings.
- Prefer squash merge. Include the Linear issue ID in commits, PR title/body, and the final merge message.
- Remove the worktree and branches only after confirming the merge. Never delete a worktree containing uncommitted changes.

## Quality gates

- Follow red → green → refactor and retain concise evidence of the initial failure.
- Run focused tests while developing and all repository-defined lint, typecheck, test, and build gates before review.
- Use Playwright locally for browser-visible behavior when applicable. Do not introduce Playwright merely for non-UI work.
- Preserve deterministic tests, isolated Git configuration, and temporary directories. Do not depend on global Git identity or mutate global configuration.

## Local skills

- `$sdlc`: select/resume work and orchestrate delivery.
- `$refine-ticket`: gap analysis and Definition of Ready refinement.
- `$plan-ticket`: independent readiness check and development plan.
- `$code-ticket`: test-first implementation and review repairs.
- `$review-ticket`: independent verification and PR verdict.

If skill discovery is unavailable, read the matching `.agents/skills/<name>/SKILL.md` and follow it directly.
