import { readFileSync } from "node:fs";

const source = readFileSync("app.mjs", "utf8");
const [needle] = process.argv.slice(2);
process.exit(source.includes(needle) ? 0 : 1);
