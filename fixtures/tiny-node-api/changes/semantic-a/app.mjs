import { addRoute } from "./server.mjs";

addRoute("/policy", { status: 200, body: { audience: "internal" } });
