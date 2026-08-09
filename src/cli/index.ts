#!/usr/bin/env node
import { runProgram } from "./program.js";

const controller = new AbortController();
process.once("SIGINT", () => {
  controller.abort();
});

const outcome = await runProgram(process.argv.slice(2), controller.signal);
if (outcome.stdout) process.stdout.write(outcome.stdout);
if (outcome.stderr) process.stderr.write(outcome.stderr);
process.exitCode = outcome.exitCode;
