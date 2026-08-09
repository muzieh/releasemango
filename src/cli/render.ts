export interface CliOutcome {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
}

export const line = (value: string): string =>
  value.endsWith("\n") ? value : `${value}\n`;

export function diagnostic(
  command: string,
  code: string,
  message: string,
  json: boolean,
  exitCode = 2,
): CliOutcome {
  const text = `${code}: ${message}`;
  return json
    ? {
        exitCode,
        stdout: `${JSON.stringify({ schemaVersion: 1, command, ok: false, diagnostics: [{ code, message }] })}\n`,
      }
    : { exitCode, stderr: `${text}\n` };
}
