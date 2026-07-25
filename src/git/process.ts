import { execa } from "execa";

export interface ProcessRequest {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface ProcessRecord {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly exitCode: number | null;
}

export type ProcessResult =
  | (ProcessRecord & {
      readonly kind: "completed";
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
      readonly termination: "exit";
    })
  | (ProcessRecord & {
      readonly kind:
        "adapter-failed" | "spawn-failed" | "timed-out" | "cancelled";
      readonly message: string;
    });

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessResult>;
}

export interface ProcessRunnerOptions {
  readonly allowedEnvironment?: readonly string[];
}

export function createProcessRunner(
  options: ProcessRunnerOptions = {},
): ProcessRunner {
  const allowed = new Set(options.allowedEnvironment ?? []);
  return {
    async run(request): Promise<ProcessResult> {
      const identity = Object.freeze({
        executable: request.executable,
        args: Object.freeze([...request.args]),
        cwd: request.cwd,
      });
      const environment = request.environment ?? {};
      const disallowed = Object.keys(environment).find(
        (key) => !allowed.has(key),
      );
      if (disallowed !== undefined) {
        return Object.freeze({
          ...identity,
          kind: "adapter-failed",
          exitCode: null,
          message: "Environment override is not allowed",
        });
      }

      try {
        const result = await execa(request.executable, request.args, {
          cwd: request.cwd,
          env: environment,
          shell: false,
          reject: false,
          encoding: "utf8",
          ...(request.timeoutMs === undefined
            ? {}
            : { timeout: request.timeoutMs }),
          ...(request.signal === undefined
            ? {}
            : { cancelSignal: request.signal }),
        });
        if (typeof result.exitCode !== "number") {
          const failure = asExecaFailure(result);
          const kind = failure.isCanceled
            ? "cancelled"
            : failure.timedOut
              ? "timed-out"
              : "spawn-failed";
          return Object.freeze({
            ...identity,
            kind,
            exitCode: null,
            message:
              kind === "cancelled"
                ? "Process was cancelled"
                : kind === "timed-out"
                  ? "Process timed out"
                  : "Process could not be started",
          });
        }
        return Object.freeze({
          ...identity,
          kind: "completed",
          exitCode: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          termination: "exit",
        });
      } catch (error: unknown) {
        const failure = asExecaFailure(error);
        const kind = failure.isCanceled
          ? "cancelled"
          : failure.timedOut
            ? "timed-out"
            : failure.code === "ENOENT"
              ? "spawn-failed"
              : "spawn-failed";
        return Object.freeze({
          ...identity,
          kind,
          exitCode: null,
          message:
            kind === "cancelled"
              ? "Process was cancelled"
              : kind === "timed-out"
                ? "Process timed out"
                : "Process could not be started",
        });
      }
    },
  };
}

function asExecaFailure(error: unknown): {
  readonly code?: string;
  readonly timedOut?: boolean;
  readonly isCanceled?: boolean;
} {
  if (typeof error !== "object" || error === null) return {};
  return error;
}
