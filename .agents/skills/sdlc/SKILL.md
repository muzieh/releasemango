---
name: sdlc
description: Orchestrate the project-local Release Mango delivery workflow from Linear issue selection through refinement, planning, test-first implementation, independent review, GitHub pull request, and merge. Use when the user invokes sdlc, asks to continue the next project task, or wants an eligible Linear ticket delivered end to end.
---

# Release Mango SDLC

Read `../../../CLAUDE.md` and `references/state-machine.md` before acting. Never use the Maister plugin.

## Select work

1. Fetch the Release Mango project and its open issues from Linear, including relations.
2. Reconcile Linear with open GitHub pull requests and local `.sdlc/active/` handoffs before selecting new work.
3. Resume an in-flight issue before starting another. Otherwise choose the highest-priority unblocked issue in the MVP milestone; break ties by dependency impact, then oldest creation time.
4. Process one ticket per invocation unless the user explicitly asks for more.
5. Never run more than three agents concurrently, including the orchestrator. Default to one worker at a time because the stages are sequential.

## Drive the state machine

Use a fresh agent/context for each independent gate when the runtime supports agents. Give it only the issue identifier, repository path, worktree path when applicable, and skill name. The worker must load the ticket and handoff itself.

1. Run `$refine-ticket`. If the issue is not ready, let it refine Linear and repeat the DoR gate. Stop when a product decision cannot safely be inferred.
2. Run `$plan-ticket`. It independently verifies DoR and writes `.sdlc/active/<issue>/plan.md`. If it rejects readiness, return to refinement.
3. Create branch `<linear-branch-name>` and worktree `../releasemango-worktrees/<issue-lowercase>` from updated `main`. Never implement in the primary checkout.
4. Run `$code-ticket` in that worktree. Require red/green/refactor evidence and all relevant gates.
5. Push the branch and create or update a GitHub pull request linked to the Linear issue. Do not create duplicate PRs.
6. Run `$review-ticket` with an agent that did not implement the change.
7. On `changes-requested`, send only the PR URL and review artifact path back to `$code-ticket`; then rerun tests and independent review. Cap this loop at three rounds per invocation and report the blocker if it persists.
8. On `approved`, wait for required GitHub checks. Merge using squash merge, delete the remote branch, mark Linear Done, and remove the worktree. Never bypass branch protection or merge with failing/pending checks.

## Synchronize safely

- Linear is the source of truth for scope, acceptance criteria, dependencies, and lifecycle state.
- GitHub is the source of truth for code, CI, review conversation, and merge state.
- `<primary-checkout>/.sdlc/active/<issue>/` is the compact cross-agent handoff. Resolve the primary checkout with `git worktree list --porcelain`; keep only `brief.md`, `plan.md`, `implementation.md`, and `review.md`, overwrite rather than append, and never commit these files.
- Put a concise Linear comment at gate transitions with links to the PR and repository artifact paths. Never paste full plans, logs, diffs, or conversations into Linear.
- Before every write, reread the current issue/PR state. Use issue IDs, commit SHAs, and review round numbers to make retries idempotent.
- If Linear, GitHub, and the handoff disagree, stop mutations, reconcile from Git/PR evidence, and leave a short Linear note.

## Finish

Report the selected issue, current/final gate, PR link, tests/checks, merge commit if merged, and any decision required from the user.
