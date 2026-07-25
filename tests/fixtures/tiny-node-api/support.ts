import { createHash } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cp, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const fixtureRoot = new URL(
  "../../../fixtures/tiny-node-api/",
  import.meta.url,
);

export interface State {
  units: string[];
  expect: string;
  checks: string[];
}

interface Manifest {
  units: Record<string, { requires: string[]; files: string[] }>;
  states: Record<string, State>;
}

export async function loadManifest(): Promise<Manifest> {
  return JSON.parse(
    await readFile(new URL("states.json", fixtureRoot), "utf8"),
  ) as Manifest;
}

export async function materialize(units: string[]): Promise<string> {
  const manifest = await loadManifest();
  const root = await mkdtemp(join(tmpdir(), "tiny-node-api-"));
  await cp(new URL("baseline/", fixtureRoot), root, { recursive: true });
  for (const unit of units) {
    const definition = manifest.units[unit];
    if (definition === undefined) throw new Error(`unknown unit: ${unit}`);
    for (const file of definition.files) {
      await cp(
        new URL(`changes/${unit}/${file}`, fixtureRoot),
        join(root, file),
      );
    }
  }
  return root;
}

export async function start(
  root: string,
): Promise<{ child: ChildProcessWithoutNullStreams; port: number }> {
  const child = spawn(process.execPath, ["app.mjs"], {
    cwd: root,
    env: {},
    stdio: ["pipe", "pipe", "pipe"],
  });
  const stderr: string[] = [];
  child.stderr
    .setEncoding("utf8")
    .on("data", (chunk: string) => stderr.push(chunk));
  const lines = createInterface({ input: child.stdout });
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`readiness timeout: ${stderr.join("")}`));
    }, 3_000);
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`startup exited ${String(code)}: ${stderr.join("")}`));
    });
    lines.on("line", (line) => {
      const ready = JSON.parse(line) as { event?: string; port?: number };
      if (ready.event === "ready" && ready.port !== undefined) {
        clearTimeout(timer);
        resolve({ child, port: ready.port });
      }
    });
  });
}

export async function request(
  port: number,
  path: string,
): Promise<{
  status: number;
  body: unknown;
}> {
  const response = await fetch(`http://127.0.0.1:${port.toString()}${path}`);
  return { status: response.status, body: (await response.json()) as unknown };
}

export async function stop(
  child: ChildProcessWithoutNullStreams,
): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once("exit", () => {
      resolve();
    });
    child.kill("SIGTERM");
  });
}

export async function remove(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

export async function fixtureFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  async function visit(url: URL): Promise<void> {
    const entries = await readdir(url, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      hash.update(entry.name);
      const child = new URL(
        `${entry.name}${entry.isDirectory() ? "/" : ""}`,
        url,
      );
      if (entry.isDirectory()) await visit(child);
      else hash.update(await readFile(child));
    }
  }
  await visit(fixtureRoot);
  return hash.digest("hex");
}
