import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const frame = (value: Uint8Array): Buffer => {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(value.byteLength));
  return Buffer.concat([length, value]);
};

export async function fingerprintAssetBundle(root: string): Promise<string> {
  const hash = createHash("sha256");
  const visit = async (path: string, prefix = ""): Promise<void> => {
    const entries = await readdir(path, { withFileTypes: true });
    entries.sort((left, right) =>
      Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)),
    );
    for (const entry of entries) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const encodedName = Buffer.from(name);
      if (entry.isSymbolicLink())
        throw new Error(`Asset bundle symlink is not allowed: ${name}`);
      if (entry.isDirectory()) {
        hash.update(Buffer.from([0x44]));
        hash.update(frame(encodedName));
        await visit(join(path, entry.name), name);
      } else if (entry.isFile()) {
        const content = await readFile(join(path, entry.name));
        hash.update(Buffer.from([0x46]));
        hash.update(frame(encodedName));
        hash.update(frame(content));
      } else throw new Error(`Unsupported asset bundle entry: ${name}`);
    }
  };
  await visit(root);
  return hash.digest("hex");
}
