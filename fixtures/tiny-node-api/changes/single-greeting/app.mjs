import { addRoute } from "./server.mjs";

addRoute("/greeting", { status: 200, body: { greeting: "hello" } });
