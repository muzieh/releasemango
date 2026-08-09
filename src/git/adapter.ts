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

export interface GitOperationOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
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

export interface TreeCommitRequest extends CommitRequest {
  readonly tree: string;
  readonly parents: readonly string[];
}

export interface RefEntry {
  readonly name: string;
  readonly id: string;
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

export interface GitFailure {
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
  writeTree(): Promise<{ readonly ok: true; readonly id: string } | GitFailure>;
  commitTree(
    request: TreeCommitRequest,
  ): Promise<{ readonly ok: true; readonly id: string } | GitFailure>;
  updateRef(ref: string, id: string): Promise<BasicResult>;
  listRefs(
    prefix?: string,
  ): Promise<
    { readonly ok: true; readonly entries: readonly RefEntry[] } | GitFailure
  >;
  createBranch(name: string): Promise<BasicResult>;
  switchBranch(name: string): Promise<BasicResult>;
  resolveRef(
    ref: string,
    options?: GitOperationOptions,
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
  addDetachedWorktree(
    path: string,
    ref: string,
    options?: GitOperationOptions,
  ): Promise<BasicResult>;
  removeWorktree(
    path: string,
    options?: GitOperationOptions,
  ): Promise<BasicResult>;
  isAncestor(
    ancestor: string,
    descendant: string,
    options?: GitOperationOptions,
  ): Promise<{ readonly ok: true; readonly isAncestor: boolean } | GitFailure>;
}

const gitEnvironmentKeys = [
  "HOME",
  "XDG_CONFIG_HOME",
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_TEMPLATE_DIR",
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
    options: GitOperationOptions = {},
  ): Promise<CompletedProcess | GitFailure> {
    const request: ProcessRequest = {
      executable: "git",
      args,
      cwd: repository,
      environment: { ...baseEnvironment, ...environment },
      timeoutMs: options.timeoutMs ?? 20_000,
      ...options,
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
    async writeTree() {
      const result = await git("write-tree", ["write-tree"]);
      return isGitFailure(result)
        ? result
        : Object.freeze({ ok: true, id: result.stdout.trim() });
    },
    async commitTree(request) {
      const result = await git(
        "commit-tree",
        [
          "-c",
          "commit.gpgSign=false",
          "commit-tree",
          request.tree,
          ...request.parents.flatMap((parent) => ["-p", parent]),
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
      return isGitFailure(result)
        ? result
        : Object.freeze({ ok: true, id: result.stdout.trim() });
    },
    updateRef(ref, id) {
      return basic("update-ref", ["update-ref", ref, id]);
    },
    async listRefs(prefix = "refs/") {
      const result = await git("list-refs", [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)",
        prefix,
      ]);
      if (isGitFailure(result)) return result;
      const entries = result.stdout
        .split("\n")
        .filter(Boolean)
        .map((record) => {
          const [name = "", id = ""] = record.split("\0");
          return Object.freeze({ name, id });
        });
      return Object.freeze({ ok: true, entries: Object.freeze(entries) });
    },
    createBranch(name) {
      return basic("create-branch", ["branch", name]);
    },
    switchBranch(name) {
      return basic("switch-branch", ["switch", name]);
    },
    async resolveRef(ref, options = {}) {
      const result = await git(
        "resolve-ref",
        ["rev-parse", "--verify", ref],
        {},
        options,
      );
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
    async addDetachedWorktree(path, ref, options = {}) {
      const result = await git(
        "add-detached-worktree",
        ["worktree", "add", "--detach", "--", path, ref],
        {},
        options,
      );
      return isGitFailure(result) ? result : Object.freeze({ ok: true });
    },
    async removeWorktree(path, options = {}) {
      const result = await git(
        "remove-worktree",
        ["worktree", "remove", "--force", "--", path],
        {},
        options,
      );
      return isGitFailure(result) ? result : Object.freeze({ ok: true });
    },
    async isAncestor(ancestor, descendant, options = {}) {
      const process = await runner.run({
        executable: "git",
        args: ["merge-base", "--is-ancestor", ancestor, descendant],
        cwd: repository,
        environment: baseEnvironment,
        ...options,
      });
      if (process.kind === "completed" && [0, 1].includes(process.exitCode)) {
        return Object.freeze({
          ok: true,
          isAncestor: process.exitCode === 0,
        });
      }
      return Object.freeze({
        ok: false,
        operation: "is-ancestor",
        process,
      });
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
