#!/usr/bin/env node
import { createRequire } from "node:module";
import { Command } from "commander";

interface PackageMetadata {
  version: string;
}

const require = createRequire(import.meta.url);
const packageMetadata = require("../../package.json") as PackageMetadata;

new Command()
  .name("releasemango")
  .description("Practice release engineering in generated repositories")
  .version(packageMetadata.version)
  .parse();
