---
name: code-ticket
description: Implement or repair a planned Release Mango Linear issue in its dedicated Git worktree using red-green-refactor development. Use after the planning gate, and again when an independent review requests changes.
---

# Code a ticket

Read `../../../CLAUDE.md`, the Linear issue, and the primary checkout's `.sdlc/active/<issue>/brief.md`, `plan.md`, and `review.md` if present. Resolve the primary checkout with `git worktree list --porcelain`. Work on product files only in the assigned worktree; handoff files remain in the primary checkout and are never committed. Never use Maister.

1. Confirm the branch/worktree matches the issue and begins from current `main`; preserve unrelated user changes.
2. Move the Linear issue to In Progress when actual coding starts.
3. Add or change the smallest focused test first. Run it and record the expected failure; a compile error counts only if it demonstrates the missing contract.
4. Implement the minimum change to pass, rerun the focused test, then refactor without changing behavior.
5. Run the plan's focused and full verification commands. Use Playwright for browser-visible flows when the project has UI behavior; save no bulky traces unless a failure needs them.
6. Inspect the diff for secrets, generated noise, debug code, scope creep, and accidental handoff artifacts. Commit coherent changes with the Linear issue ID in the message.
7. Write `<primary-checkout>/.sdlc/active/<issue>/implementation.md`: head SHA, failing test and failure summary, passing commands, acceptance-criteria mapping, and residual risks. Keep logs summarized.
8. On review repair, address every current unresolved finding, note each disposition in the implementation artifact, and never rewrite reviewer conclusions.
9. Push only the issue branch. Never merge, force-push, or mark Done.

Stop and report if the plan is invalidated, scope must materially expand, or tests cannot establish the requested behavior.
