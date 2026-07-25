import { jsonResponse } from "./json-response.mjs";
import { addRoute } from "./server.mjs";

addRoute("/shared", {
  status: 200,
  body: jsonResponse({ feature: "dependent" }),
});
