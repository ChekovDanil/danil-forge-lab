import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { KnowledgeDesk } from "./src/desk.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const port = Number(process.env.PORT ?? 3260);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".woff2": "font/woff2" };
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY"
};

let desk;
function seedDesk() {
  desk = new KnowledgeDesk();
  desk.ask("Как восстановить доступ к аккаунту?");
  desk.ask("Как выгрузить данные в CSV?");
  desk.ask("EU: какой срок хранения удалённых данных?");
}
seedDesk();

function json(response, status, body) {
  response.writeHead(status, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 32_000) throw new Error("payload_too_large");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { ok: true, service: "knowledge-desk", provider: "deterministic-demo" });
    if (request.method === "GET" && url.pathname === "/api/state") return json(response, 200, desk.snapshot());
    if (request.method === "POST" && url.pathname === "/api/ask") {
      const body = await readJson(request);
      if (typeof body.question !== "string") return json(response, 400, { error: "question_required" });
      return json(response, 201, desk.ask(body.question, body.context ?? {}));
    }
    if (request.method === "POST" && url.pathname === "/api/feedback") {
      const body = await readJson(request);
      return json(response, 201, desk.addFeedback(body.questionId, body.value, body.note));
    }
    if (request.method === "POST" && url.pathname === "/api/reset") {
      seedDesk();
      return json(response, 200, desk.snapshot());
    }
    if (!['GET', 'HEAD'].includes(request.method ?? "GET")) {
      response.writeHead(405, { ...securityHeaders, Allow: "GET, HEAD, POST" });
      return response.end();
    }
    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^[/\\]+/, "");
    const file = normalize(join(publicRoot, relative));
    if (!file.startsWith(publicRoot) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, securityHeaders);
      return response.end("Not found");
    }
    response.writeHead(200, { ...securityHeaders, "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  } catch (error) {
    json(response, error.message === "payload_too_large" ? 413 : 400, { error: error.message || "bad_request" });
  }
}).listen(port, "127.0.0.1", () => console.log(`Knowledge Desk: http://127.0.0.1:${port}`));
