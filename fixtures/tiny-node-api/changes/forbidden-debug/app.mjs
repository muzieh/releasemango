import { addRoute } from "./server.mjs";

addRoute("/debug", { status: 200, body: { secrets: "exposed" } });
