import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);

export const packageVersion = (): string =>
  (require("../../package.json") as { version: string }).version;

export const tutorialAssets = () => ({
  scenario: resolve(packageRoot, "scenarios/tutorial-01.yml"),
  fixture: resolve(packageRoot, "fixtures/tiny-node-api"),
  judgingBundle: resolve(packageRoot, "fixtures/tiny-node-api"),
});
