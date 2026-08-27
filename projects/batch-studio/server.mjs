import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { strToU8, zipSync } from "fflate";
import sharp from "sharp";
import { createBatchEngine } from "./src/batch-engine.js";

const root = fileURLToPath(new URL(".", import.meta.url));
const publicRoot = join(root, "public");
const port = Number(process.env.PORT ?? 3300);
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml"
};
const securityHeaders = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

function svgLabel(label, accent, width, height) {
  const safe = label.replace(/[<>&"]/gu, "");
  return Buffer.from(
    "<svg width='" + width + "' height='" + height + "' xmlns='http://www.w3.org/2000/svg'>" +
    "<circle cx='" + Math.round(width * 0.72) + "' cy='" + Math.round(height * 0.42) + "' r='" + Math.round(Math.min(width, height) * 0.22) + "' fill='" + accent + "' fill-opacity='.78'/>" +
    "<path d='M0 " + Math.round(height * 0.78) + " C " + Math.round(width * 0.25) + " " + Math.round(height * 0.64) + ", " + Math.round(width * 0.55) + " " + Math.round(height * 0.98) + ", " + width + " " + Math.round(height * 0.7) + " L " + width + " " + height + " L 0 " + height + "Z' fill='#111722' fill-opacity='.34'/>" +
    "<text x='" + Math.round(width * 0.08) + "' y='" + Math.round(height * 0.2) + "' font-family='Arial, sans-serif' font-size='" + Math.max(26, Math.round(width * 0.04)) + "' fill='#f6f4ee' letter-spacing='4'>" + safe + "</text>" +
    "<text x='" + Math.round(width * 0.08) + "' y='" + Math.round(height * 0.27) + "' font-family='Arial, sans-serif' font-size='" + Math.max(13, Math.round(width * 0.015)) + "' fill='#f6f4ee' fill-opacity='.64'>SAMPLE SOURCE · OWNED DEMO ASSET</text>" +
    "</svg>"
  );
}

async function sampleImage(name, width, height, background, accent, format = "png") {
  let pipeline = sharp({ create: { width, height, channels: 3, background } }).composite([{ input: svgLabel(name, accent, width, height) }]);
  pipeline = format === "jpeg" ? pipeline.jpeg({ quality: 94 }) : pipeline.png();
  const buffer = await pipeline.toBuffer();
  return {
    name: name.toLowerCase().replace(/ /gu, "-") + (format === "jpeg" ? ".jpg" : ".png"),
    type: format === "jpeg" ? "image/jpeg" : "image/png",
    content: buffer.toString("base64"),
    encoding: "base64"
  };
}

async function sampleFiles() {
  return [
    await sampleImage("ASTER HERO", 1680, 1080, "#1d2a42", "#6f7cff"),
    await sampleImage("COBALT DETAIL", 1440, 960, "#263143", "#86a9ff", "jpeg"),
    await sampleImage("EMBER PORTRAIT", 1080, 1440, "#34242b", "#df816d"),
    await sampleImage("PAPER STILL", 1280, 900, "#ada9a0", "#f2ca7d"),
    await sampleImage("NIGHT OBJECT", 1600, 1000, "#11151d", "#9185d8"),
    await sampleImage("FIELD NOTE", 1200, 800, "#25332f", "#76a6a1"),
    { name: "metadata-preview.png", type: "image/png", content: Buffer.from("damaged image payload").toString("base64"), encoding: "base64" }
  ];
}

let engine;
let repairFixture;
let workerBusy = false;

async function resetEngine() {
  engine = createBatchEngine();
  const files = await sampleFiles();
  repairFixture = await sampleImage("REPAIRED FRAME", 1400, 920, "#272b38", "#e1b86d");
  return engine.createBatch({ name: "Campaign 08 / Web set", recipeId: "web-delivery", files });
}

await resetEngine();

setInterval(async () => {
  if (workerBusy) return;
  const running = engine.state().batches.find((batch) => batch.status === "running");
  if (!running) return;
  workerBusy = true;
  try {
    await engine.processNext(running.id);
  } finally {
    workerBusy = false;
  }
}, 750).unref();

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 18_000_000) throw new Error("payload_too_large");
  }
  return body ? JSON.parse(body) : {};
}

function json(response, status, payload) {
  response.writeHead(status, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function errorStatus(message) {
  return ["batch_not_found", "job_not_found", "output_not_found"].includes(message) ? 404 : 400;
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://localhost");
  try {
    if (url.pathname === "/health" && request.method === "GET") {
      json(response, 200, { ok: true, service: "batch-studio", processor: "sharp", queue: "memory", backgroundWorker: true });
      return;
    }
    if (url.pathname === "/api/state" && request.method === "GET") {
      json(response, 200, engine.state());
      return;
    }
    if (url.pathname === "/api/reset" && request.method === "POST") {
      const batch = await resetEngine();
      json(response, 200, { batch, state: engine.state() });
      return;
    }
    if (url.pathname === "/api/batches" && request.method === "POST") {
      const body = await readJson(request);
      const batch = engine.createBatch(body);
      json(response, 201, { batch, state: engine.state() });
      return;
    }
    if (url.pathname === "/api/action" && request.method === "POST") {
      const body = await readJson(request);
      let batch;
      if (body.action === "start") batch = engine.start(body.batchId);
      else if (body.action === "pause") batch = engine.pause(body.batchId);
      else if (body.action === "cancel") batch = engine.cancel(body.batchId);
      else if (body.action === "exclude") batch = engine.exclude(body.batchId, body.jobId);
      else if (body.action === "retry-demo") batch = engine.retry(body.batchId, body.jobId, repairFixture);
      else throw new Error("unknown_action");
      json(response, 200, { batch, state: engine.state() });
      return;
    }

    const manifestMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/manifest$/u);
    if (manifestMatch && request.method === "GET") {
      const manifest = engine.manifest(decodeURIComponent(manifestMatch[1]));
      response.writeHead(200, { ...securityHeaders, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=\"batch-studio-manifest.json\"", "Cache-Control": "no-store" });
      response.end(JSON.stringify(manifest, null, 2));
      return;
    }

    const bundleMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/bundle$/u);
    if (bundleMatch && request.method === "GET") {
      const bundle = engine.bundle(decodeURIComponent(bundleMatch[1]));
      const entries = { "manifest.json": strToU8(JSON.stringify(bundle.manifest, null, 2)) };
      for (const file of bundle.files) entries["output/" + file.name] = Uint8Array.from(Buffer.from(file.content, "base64"));
      const archive = zipSync(entries, { level: 6 });
      response.writeHead(200, { ...securityHeaders, "Content-Type": "application/zip", "Content-Disposition": "attachment; filename=\"batch-studio-output.zip\"", "Cache-Control": "no-store" });
      response.end(Buffer.from(archive));
      return;
    }

    const previewMatch = url.pathname.match(/^\/api\/batches\/([^/]+)\/jobs\/([^/]+)\/outputs\/([^/]+)$/u);
    if (previewMatch && request.method === "GET") {
      const output = engine.getOutput(...previewMatch.slice(1).map(decodeURIComponent));
      response.writeHead(200, { ...securityHeaders, "Content-Type": output.mime, "Content-Disposition": "inline; filename=\"" + output.name + "\"", "Cache-Control": "private, max-age=60" });
      response.end(output.buffer);
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      json(response, 404, { error: "not_found" });
      return;
    }
    if (!["GET", "HEAD"].includes(request.method ?? "GET")) {
      response.writeHead(405, { ...securityHeaders, Allow: "GET, HEAD" });
      response.end();
      return;
    }
    const relative = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^[/\\]+/u, "");
    const file = normalize(join(publicRoot, relative));
    if (!file.startsWith(publicRoot) || !existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(404, securityHeaders);
      response.end("Not found");
      return;
    }
    response.writeHead(200, { ...securityHeaders, "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    if (request.method === "HEAD") response.end();
    else createReadStream(file).pipe(response);
  } catch (error) {
    json(response, errorStatus(error.message), { error: error.message || "request_failed" });
  }
}).listen(port, "127.0.0.1", () => {
  console.log("Batch Studio: http://127.0.0.1:" + port);
});
