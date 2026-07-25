import { addRoute } from "./server.mjs";

addRoute("/readiness", {
  status: 200,
  body: { ready: true, environment: "acceptance", detail: "candidate" },
});
