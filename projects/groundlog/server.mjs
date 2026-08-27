import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRemoteStore } from "./src/sync-core.js";

const root = fileURLToPath(new URL("./public", import.meta.url));
const PORT = Number(process.env.PORT || 3320);
const seed = [{
  id: "visit-north",
  title: "Северный фасад",
  body: "Проверить крепление у входной группы. Зафиксировать размер и состояние узла.",
  site: "Объект 14 · Корпус B",
  tags: ["осмотр", "фасад"],
  status: "draft",
  version: 3,
  updatedAt: "2026-08-27T08:00:00.000Z",
  updatedBy: "Ирина"
}, {
  id: "visit-roof",
  title: "Контур кровли",
  body: "Осмотреть примыкание у вентиляционного выхода. Видимых протечек нет.",
  site: "Объект 14 · Кровля",
  tags: ["кровля"],
  status: "ready",
  version: 2,
  updatedAt: "2026-08-26T15:20:00.000Z",
  updatedBy: "Максим"
}];
let store = createRemoteStore(seed);

const types = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml", ".png": "image/png"
};

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/remote") return json(res, 200, { notes: store.snapshot() });
    if (req.method === "POST" && req.url === "/api/sync") {
      const payload = await body(req);
      return json(res, 200, store.applyOperations(payload.operations, "Полевой специалист"));
    }
    if (req.method === "POST" && req.url === "/api/demo/collaborator-edit") {
      const next = store.collaboratorEdit("visit-north", { body: "Офис: заменить крепёж и повторно проверить узел до пятницы.", tags: ["осмотр", "фасад", "контроль"] }, "Ирина");
      return json(res, 200, { note: next });
    }
    if (req.method === "POST" && req.url === "/api/reset") {
      store = createRemoteStore(seed);
      return json(res, 200, { notes: store.snapshot() });
    }

    const pathname = new URL(req.url, "http://localhost").pathname;
    const requested = pathname === "/" ? "/index.html" : pathname;
    const safe = normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const file = join(root, safe);
    if (!file.startsWith(root)) return json(res, 403, { error: "forbidden" });
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file)] || "application/octet-stream",
      "Cache-Control": requested === "/service-worker.js" ? "no-cache" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer"
    });
    res.end(data);
  } catch (error) {
    if (error?.code === "ENOENT") return json(res, 404, { error: "not_found" });
    json(res, 500, { error: error.message });
  }
});

server.listen(PORT, "127.0.0.1", () => console.log(`Groundlog: http://127.0.0.1:${PORT}`));
