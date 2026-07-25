import { createServer } from "node:http";

const routes = new Map([["/health", { status: 200, body: { status: "ok" } }]]);

export function addRoute(path, response) {
  routes.set(path, response);
}

function sendJson(response, status, body) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

const server = createServer((request, response) => {
  const route = routes.get(request.url);
  if (request.method !== "GET" || route === undefined) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  sendJson(response, route.status, route.body);
});

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected TCP address");
  }
  console.log(JSON.stringify({ event: "ready", port: address.port }));
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
