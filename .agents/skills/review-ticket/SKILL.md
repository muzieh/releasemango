---
name: review-ticket
description: Independently review a Release Mango issue implementation and GitHub pull request against its acceptance criteria, plan, tests, architecture, and safety constraints. Use after coding or after a repair round to approve or request actionable changes.
---

# Review a ticket

Read `../../../CLAUDE.md`, the Linear issue, the primary checkout's handoff files, PR diff, commits, checks, and relevant code. Resolve the primary checkout with `git worktree list --porcelain`. The reviewer must not be the implementation agent. Never use Maister.

1. Verify each acceptance criterion against code and tests; do not infer correctness solely from the implementation report.
2. Examine correctness, regressions, failure handling, security, repository/worktree safety, determinism, maintainability, and scope.
3. Run focused tests and risk-proportionate full gates independently. For UI behavior, use Playwright when available and relevant.
4. Report only actionable findings, ordered by severity, with file/line, evidence, impact, and required outcome. Avoid style-only blocking comments already enforced by tooling.
5. Check that tests would fail without the production change and cover meaningful boundaries.
6. Write `<primary-checkout>/.sdlc/active/<issue>/review.md` with review round, reviewed head SHA, verdict, commands, and findings. Never commit it. Replace the previous round after its findings are resolved; implementation history remains in GitHub.
7. Submit the equivalent GitHub review. Add a short Linear comment containing verdict, PR link, finding count, and artifact path.

Approve only when required checks pass locally, criteria are met, no blocking finding remains, and the reviewed SHA is still the PR head. Never merge or mark Linear Done.
