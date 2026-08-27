import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MonitorEngine, buildScenario } from './src/monitor-core.mjs';

const root = fileURLToPath(new URL('./public/', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64_000) throw new Error('Request body is too large');
    chunks.push(chunk);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

export function createSignalServer(engine = new MonitorEngine()) {
  return createServer(async (req, res) => {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (method === 'GET' && url.pathname === '/api/state') return sendJson(res, 200, engine.snapshot());
      if (method === 'POST' && url.pathname === '/api/scenario') {
        const body = await readJson(req);
        engine.reset();
        for (const check of buildScenario(String(body.name ?? ''))) engine.applyCheck(check);
        return sendJson(res, 200, engine.snapshot());
      }
      const ack = url.pathname.match(/^\/api\/incidents\/([^/]+)\/ack$/);
      if (method === 'POST' && ack) {
        const body = await readJson(req);
        engine.acknowledge(decodeURIComponent(ack[1]), String(body.by || 'Вы'));
        return sendJson(res, 200, engine.snapshot());
      }
      const mute = url.pathname.match(/^\/api\/services\/([^/]+)\/mute$/);
      if (method === 'POST' && mute) {
        const body = await readJson(req);
        engine.mute(decodeURIComponent(mute[1]), Number(body.minutes ?? 30));
        return sendJson(res, 200, engine.snapshot());
      }
      if (!['GET', 'HEAD'].includes(method)) {
        res.writeHead(405, { Allow: 'GET, HEAD, POST' });
        return res.end();
      }
      const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
      const file = normalize(join(root, relative));
      if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'",
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      });
      if (method === 'HEAD') res.end();
      else createReadStream(file).pipe(res);
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
  });
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  const port = Number(process.env.PORT ?? 3400);
  createSignalServer().listen(port, '127.0.0.1', () => console.log(`Signal Bot: http://127.0.0.1:${port}`));
}
