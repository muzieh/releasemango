import type { ProcessRunner } from "./process.js";

export type GitSupport =
  | {
      readonly supported: true;
      readonly version: string;
      readonly raw: string;
    }
  | {
      readonly supported: false;
      readonly reason: "process" | "unparsable" | "unsupported";
      readonly raw: string;
      readonly version?: string;
      readonly message: string;
    };

export async function checkGitSupport(
  runner: ProcessRunner,
  cwd: string,
): Promise<GitSupport> {
  const result = await runner.run({
    executable: "git",
    args: ["--version"],
    cwd,
  });
  if (result.kind !== "completed" || result.exitCode !== 0) {
    return Object.freeze({
      supported: false,
      reason: "process",
      raw: "",
      message: "Unable to run Git; install Git >= 2.39",
    });
  }
  const raw = result.stdout.trim();
  const match = /^git version (\d+)\.(\d+)\.(\d+)/u.exec(raw);
  if (match === null) {
    return Object.freeze({
      supported: false,
      reason: "unparsable",
      raw,
      message: `Could not parse Git version: ${raw}`,
    });
  }
  const [, majorText, minorText, patchText] = match;
  if (
    majorText === undefined ||
    minorText === undefined ||
    patchText === undefined
  ) {
    return Object.freeze({
      supported: false,
      reason: "unparsable",
      raw,
      message: `Could not parse Git version: ${raw}`,
    });
  }
  const version = `${majorText}.${minorText}.${patchText}`;
  const supported =
    Number(majorText) > 2 ||
    (Number(majorText) === 2 && Number(minorText) >= 39);
  return supported
    ? Object.freeze({ supported: true, version, raw })
    : Object.freeze({
        supported: false,
        reason: "unsupported",
        version,
        raw,
        message: `Git ${version} is unsupported; install Git >= 2.39`,
      });
}
