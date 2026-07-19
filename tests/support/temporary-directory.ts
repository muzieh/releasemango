import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function withTemporaryDirectory<T>(
  useDirectory: (path: string) => Promise<T>,
): Promise<T> {
  const path = await mkdtemp(join(tmpdir(), "releasemango-test-"));
  try {
    return await useDirectory(path);
  } finally {
    await rm(path, { force: true, recursive: true });
  }
}
