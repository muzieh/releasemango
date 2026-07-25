import { addRoute } from "./server.mjs";

addRoute("/readiness", {
  status: 200,
  body: { ready: true, environment: "production" },
});
addRoute("/policy", { status: 200, body: { cache: "required" } });
