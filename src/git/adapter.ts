import { mkdir, realpath } from "node:fs/promises";
import type {
  ProcessRequest,
  ProcessResult,
  ProcessRunner,
} from "./process.js";
import { createProcessRunner } from "./process.js";

export interface GitAdapterOptions {
  readonly runner?: ProcessRunner;
  readonly environment?: Readonly<Record<string, string>>;
}

export interface CommitIdentity {
  readonly name: string;
  readonly email: string;
}

export interface CommitRequest {
  readonly message: string;
  readonly author: CommitIdentity;
  readonly authoredAt: string;
  readonly committer: CommitIdentity;
  readonly committedAt: string;
}

export interface StatusEntry {
  readonly path: string;
  readonly originalPath?: string;
  readonly index: string;
  readonly worktree: string;
}

export interface LogEntry {
  readonly id: string;
  readonly parents: readonly string[];
  readonly author: CommitIdentity;
  readonly authoredAt: string;
  readonly committer: CommitIdentity;
  readonly committedAt: string;
  readonly message: string;
}

export interface WorktreeEntry {
  readonly path: string;
  readonly head?: string;
  readonly branch?: string;
  readonly bare: boolean;
  readonly detached: boolean;
}

interface GitFailure {
  readonly ok: false;
  readonly operation: string;
  readonly process: ProcessResult;
}

type CompletedProcess = Extract<ProcessResult, { readonly kind: "completed" }>;

interface BasicSuccess {
  readonly ok: true;
}
type BasicResult = BasicSuccess | GitFailure;

export interface GitAdapter {
  initialize(initialBranch: string): Promise<BasicResult>;
  configure(key: string, value: string): Promise<BasicResult>;
  stage(paths: readonly string[]): Promise<BasicResult>;
  commit(
    request: CommitRequest,
  ): Promise<{ readonly ok: true; readonly id: string } | GitFailure>;
  createBranch(name: string): Promise<BasicResult>;
  switchBranch(name: string): Promise<BasicResult>;
  resolveRef(
    ref: string,
  ): Promise<{ readonly ok: true; readonly id: string } | GitFailure>;
  status(): Promise<
    { readonly ok: true; readonly entries: readonly StatusEntry[] } | GitFailure
  >;
  log(): Promise<
    { readonly ok: true; readonly entries: readonly LogEntry[] } | GitFailure
  >;
  listWorktrees(): Promise<
    | { readonly ok: true; readonly entries: readonly WorktreeEntry[] }
    | GitFailure
  >;
}

const gitEnvironmentKeys = [
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
] as const;

export function createGitAdapter(
  repository: string,
  options: GitAdapterOptions = {},
): GitAdapter {
  const runner =
    options.runner ??
    createProcessRunner({ allowedEnvironment: gitEnvironmentKeys });
  const baseEnvironment = options.environment ?? {};

  async function git(
    operation: string,
    args: readonly string[],
    environment: Readonly<Record<string, string>> = {},
  ): Promise<CompletedProcess | GitFailure> {
    const request: ProcessRequest = {
      executable: "git",
      args,
      cwd: repository,
      environment: { ...baseEnvironment, ...environment },
    };
    const process = await runner.run(request);
    if (process.kind === "completed" && process.exitCode === 0) return process;
    return Object.freeze({ ok: false, operation, process });
  }

  async function basic(
    operation: string,
    args: readonly string[],
  ): Promise<BasicResult> {
    const result = await git(operation, args);
    return isGitFailure(result) ? result : Object.freeze({ ok: true });
  }

  return {
    async initialize(initialBranch) {
      await mkdir(repository, { recursive: true });
      return basic("initialize", ["init", "--initial-branch", initialBranch]);
    },
    configure(key, value) {
      return basic("configure", ["config", "--local", key, value]);
    },
    stage(paths) {
      return basic("stage", ["add", "--", ...paths]);
    },
    async commit(request) {
      const result = await git(
        "commit",
        [
          "-c",
          "commit.gpgSign=false",
          "commit",
          "--cleanup=verbatim",
          "-m",
          request.message,
        ],
        {
          GIT_AUTHOR_NAME: request.author.name,
          GIT_AUTHOR_EMAIL: request.author.email,
          GIT_AUTHOR_DATE: request.authoredAt,
          GIT_COMMITTER_NAME: request.committer.name,
          GIT_COMMITTER_EMAIL: request.committer.email,
          GIT_COMMITTER_DATE: request.committedAt,
        },
      );
      if (isGitFailure(result)) return result;
      const ref = await this.resolveRef("HEAD");
      return ref.ok ? Object.freeze({ ok: true, id: ref.id }) : ref;
    },
    createBranch(name) {
      return basic("create-branch", ["branch", name]);
    },
    switchBranch(name) {
      return basic("switch-branch", ["switch", name]);
    },
    async resolveRef(ref) {
      const result = await git("resolve-ref", ["rev-parse", "--verify", ref]);
      return isGitFailure(result)
        ? result
        : Object.freeze({ ok: true, id: result.stdout.trim() });
    },
    async status() {
      const result = await git("status", [
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
      ]);
      if (isGitFailure(result)) return result;
      const records = result.stdout.split("\0").filter(Boolean);
      const entries: StatusEntry[] = [];
      for (let cursor = 0; cursor < records.length; cursor += 1) {
        const record = records[cursor];
        if (record === undefined) continue;
        const index = record[0] ?? " ";
        const worktree = record[1] ?? " ";
        const renamedOrCopied = "RC".includes(index) || "RC".includes(worktree);
        const originalPath = renamedOrCopied ? records[cursor + 1] : undefined;
        if (renamedOrCopied && originalPath !== undefined) cursor += 1;
        entries.push(
          Object.freeze({
            index,
            worktree,
            path: record.slice(3),
            ...(originalPath === undefined ? {} : { originalPath }),
          }),
        );
      }
      return Object.freeze({ ok: true, entries: Object.freeze(entries) });
    },
    async log() {
      const result = await git("log", [
        "log",
        "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%cn%x00%ce%x00%cI%x00%s%x00",
      ]);
      if (isGitFailure(result)) return result;
      const fields = result.stdout.split("\0");
      const entries: LogEntry[] = [];
      for (let index = 0; index + 8 < fields.length; index += 9) {
        const id = fields[index]?.trim();
        if (!id) continue;
        entries.push(
          Object.freeze({
            id,
            parents: Object.freeze(
              (fields[index + 1] ?? "").split(" ").filter(Boolean),
            ),
            author: Object.freeze({
              name: fields[index + 2] ?? "",
              email: fields[index + 3] ?? "",
            }),
            authoredAt: fields[index + 4] ?? "",
            committer: Object.freeze({
              name: fields[index + 5] ?? "",
              email: fields[index + 6] ?? "",
            }),
            committedAt: fields[index + 7] ?? "",
            message: fields[index + 8] ?? "",
          }),
        );
      }
      return Object.freeze({ ok: true, entries: Object.freeze(entries) });
    },
    async listWorktrees() {
      const result = await git("list-worktrees", [
        "worktree",
        "list",
        "--porcelain",
      ]);
      if (isGitFailure(result)) return result;
      const canonicalRepository = await realpath(repository);
      const entries = result.stdout
        .split(/\n\n/u)
        .filter(Boolean)
        .map(parseWorktree)
        .map((entry) =>
          entry.path === canonicalRepository
            ? Object.freeze({ ...entry, path: repository })
            : entry,
        );
      return Object.freeze({ ok: true, entries: Object.freeze(entries) });
    },
  };
}

function isGitFailure(
  value: CompletedProcess | GitFailure,
): value is GitFailure {
  return "ok" in value;
}

function parseWorktree(record: string): WorktreeEntry {
  const values = new Map<string, string>();
  for (const line of record.split("\n")) {
    const separator = line.indexOf(" ");
    values.set(
      separator === -1 ? line : line.slice(0, separator),
      separator === -1 ? "" : line.slice(separator + 1),
    );
  }
  const head = values.get("HEAD");
  const branch = values.get("branch");
  return Object.freeze({
    path: values.get("worktree") ?? "",
    ...(head === undefined ? {} : { head }),
    ...(branch === undefined ? {} : { branch }),
    bare: values.has("bare"),
    detached: values.has("detached"),
  });
}
