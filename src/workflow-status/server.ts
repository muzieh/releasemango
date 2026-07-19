import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, normalize, resolve } from "node:path";
import { ZodError } from "zod";
import { WorkflowStatusStore } from "./store.js";

export interface StatusServerOptions {
  host: string;
  port: number;
  publicDirectory: string;
  token?: string;
}

export function createStatusServer(
  store: WorkflowStatusStore,
  options: StatusServerOptions,
): Server {
  const subscribers = new Set<ServerResponse>();
  return createServer((request, response) => {
    void handleRequest(request, response, store, options, subscribers);
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  store: WorkflowStatusStore,
  options: StatusServerOptions,
  subscribers: Set<ServerResponse>,
): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/status") {
      sendJson(response, 200, store.getSnapshot());
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/events/stream") {
      response.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      subscribers.add(response);
      response.write(`data: ${JSON.stringify(store.getSnapshot())}\n\n`);
      request.on("close", () => subscribers.delete(response));
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/events") {
      if (!authorized(request.headers.authorization, options.token)) {
        sendJson(response, 401, { error: "unauthorized" });
        return;
      }
      const snapshot = await store.apply(await readJsonBody(request));
      const payload = `data: ${JSON.stringify(snapshot)}\n\n`;
      for (const subscriber of subscribers) subscriber.write(payload);
      sendJson(response, 202, snapshot);
      return;
    }
    if (request.method === "GET" || request.method === "HEAD") {
      await serveStatic(response, options.publicDirectory, url.pathname);
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  } catch (error: unknown) {
    if (error instanceof ZodError || error instanceof SyntaxError) {
      sendJson(response, 400, {
        error: "invalid_event",
        details: String(error),
      });
      return;
    }
    sendJson(response, 500, { error: "internal_error" });
  }
}

async function readJsonBody(request: NodeJS.ReadableStream): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > 1_000_000)
      throw new SyntaxError("request body too large");
  }
  return JSON.parse(body);
}

function authorized(
  header: string | undefined,
  token: string | undefined,
): boolean {
  return token === undefined || header === `Bearer ${token}`;
}

async function serveStatic(
  response: ServerResponse,
  publicDirectory: string,
  pathname: string,
): Promise<void> {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const root = resolve(publicDirectory);
  const path = resolve(root, normalize(requested));
  if (!path.startsWith(`${root}/`) && path !== root) {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  try {
    await access(path);
    if (!(await stat(path)).isFile()) throw new Error("not a file");
  } catch {
    sendJson(response, 404, { error: "not_found" });
    return;
  }
  response.writeHead(200, { "Content-Type": contentType(extname(path)) });
  createReadStream(path).pipe(response);
}

function contentType(extension: string): string {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
    }[extension] ?? "application/octet-stream"
  );
}

function sendJson(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(value)}\n`);
}
