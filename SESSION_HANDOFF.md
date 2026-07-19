# Release Mango — Session Handoff

## Current objective

Build a terminal-based training game for release managers who work with Gitflow-style repositories and prepare selective acceptance and production releases using real Git commands and cherry-picking.

## Product concept

- The game generates a disposable, realistic Git repository for each exercise.
- Several developers contribute feature and infrastructure commits during a sprint.
- Only selected completed features may ship; unfinished work on `main` must remain excluded.
- The player works outside the app with normal Git commands: inspect history, create branches, cherry-pick commits, resolve conflicts, and run tests.
- Release Mango presents the brief and validates the resulting acceptance or production branch.
- Evaluation should prioritize the resulting software behavior, not merely check for exact commit hashes.
- Agent skills for Codex and Claude Code should call deterministic Release Mango inspection commands and explain the verdict as a release mentor.

## Proposed game loop

1. Generate a sprint repository.
2. Read the release brief and ticket statuses.
3. Inspect commit history and dependencies.
4. Prepare `release/acceptance` using real Git operations.
5. Evaluate required behavior, forbidden/incomplete features, tests, and Git integrity.
6. Prepare `release/production` from the correct production baseline.
7. Resolve textual and semantic conflicts.
8. Receive a score, verdict, and coaching feedback.

## Suggested CLI

```bash
releasemango new tutorial-01
releasemango brief
releasemango status
releasemango hint
releasemango evaluate acceptance
releasemango evaluate production
```

Possible coaching modes:

```bash
releasemango evaluate --mode exam
releasemango evaluate --mode coach
releasemango solution
```

## Difficulty progression

1. Clean, single-commit cherry-picks with no conflicts.
2. Multi-commit features and incomplete picks.
3. Dependencies and shared infrastructure.
4. Textual merge conflicts.
5. Semantic conflicts that Git does not detect.
6. Different acceptance and production scopes, hotfixes, reverts, and superseded commits.
7. Incident/audit exercises involving an incorrectly assembled release.

## Proposed implementation

- TypeScript and Node.js.
- Git invoked as subprocesses.
- YAML scenario definitions.
- Vitest for deterministic evaluator tests.
- Simple CLI first; optional terminal UI later.
- Separate Release Mango source repository from generated player workspaces.

Suggested source layout:

```text
src/cli/
src/scenarios/
src/generator/
src/git/
src/evaluator/
src/scoring/
scenarios/
templates/tiny-node-api/
agent-skills/codex/
agent-skills/claude/
tests/
```

## Linear project

Project URL:

https://linear.app/oversoft/project/releasemanago-8ff271791973/overview

The official Linear MCP server was added to the local Codex configuration:

```text
linear  https://mcp.linear.app/mcp
```

Before restart, `codex mcp list` reported the server as enabled but displayed `Auth: Unsupported`, and no Linear MCP tools were exposed in the running session. The likely next step is to restart Codex so MCP capabilities are loaded into a fresh session.

## Continue after restart

1. Run `codex mcp list`.
2. If needed, run `codex mcp login linear` and complete browser authorization.
3. Open a new Codex session in this repository.
4. Ask: `Read SESSION_HANDOFF.md, then check access to the Linear project and summarize its overview and issues.`
5. Use the Linear project content to refine the MVP scope, milestones, and implementation plan.

## Repository state

At the start of this work, `/Users/muzieh/prog/releasemango` was empty and was not yet a Git repository. This handoff file is the first project artifact.
