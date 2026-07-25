import { addRoute } from "./server.mjs";

addRoute("/policy", { status: 200, body: { cache: "private" } });
