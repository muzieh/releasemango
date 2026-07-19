# SDLC state machine

| Gate | Entry | Durable output | Linear state | Next |
|---|---|---|---|---|
| Select | No active work or resumable work found | issue ID | Backlog | Refine |
| Refine | Unblocked issue | refined description + `brief.md` | Backlog | Plan |
| Plan | DoR passes | `plan.md` | Backlog | Code |
| Code | Plan approved, worktree exists | commits + `implementation.md` | In Progress | Review |
| Review | PR and green local gates exist | PR review + `review.md` | In Progress | Code or Merge |
| Merge | Approval and required checks green | squash merge | Done | Cleanup |

## Definition of Ready

An issue is ready only when its outcome, boundaries, dependencies, acceptance criteria, red/green test, verification commands, and important assumptions are explicit. Every criterion must be observable. No unresolved product decision may materially change implementation.

## Definition of Done

Acceptance criteria pass; relevant tests, typecheck, lint, and build pass; PR is independently approved; required GitHub checks pass; no unresolved review thread remains; docs/ADR are updated when behavior or architecture changes; branch is squash-merged to `main`; Linear is Done; worktree is removed.

## Recovery

- Existing PR: resume it; do not select another ticket.
- Existing branch without PR: validate handoff and open/update the PR.
- Linear says Done but PR is unmerged: do not code; reconcile and reopen/move state if needed.
- Merge already happened: update Linear and clean the worktree idempotently.
- Conflicting active handoffs: prefer the PR whose head SHA exists on GitHub, then report the stale artifact.
