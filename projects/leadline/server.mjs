import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const port = Number(process.env.PORT ?? 3040);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

createServer(async (request, response) => {
  if (!["GET", "HEAD"].includes(request.method ?? "GET")) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  try {
    const raw = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const pathname = raw === "/" ? "/public/index.html" : raw;
    if (!/^\/(public|src)\//.test(pathname) || pathname.includes("..")) throw new Error("Forbidden");
    const target = resolve(root, `.${pathname}`);
    if (relative(root, target).startsWith("..")) throw new Error("Forbidden");
    const file = await readFile(target);
    response.writeHead(200, {
      "Content-Type": types[extname(target)] ?? "application/octet-stream",
      "Content-Security-Policy": "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    if (request.method === "HEAD") response.end();
    else response.end(file);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`Leadline: http://127.0.0.1:${port}`));
