import { multiResponse } from "./multi-response.mjs";
import { addRoute } from "./server.mjs";

addRoute("/multi", { status: 200, body: multiResponse() });
