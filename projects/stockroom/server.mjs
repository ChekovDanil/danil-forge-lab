import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };
const port = Number(process.env.PORT || 3030);
createServer(async (request, response) => {
  try {
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { allow: 'GET, HEAD' }); response.end(); return;
    }
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const path = pathname === '/' ? '/public/index.html' : pathname;
    if (!/^\/(public|src)\//.test(path) || path.includes('..')) throw new Error('Forbidden');
    const target = resolve(root, `.${path}`), outside = relative(root, target).startsWith('..');
    if (outside) throw new Error('Forbidden');
    const file = await readFile(target);
    response.writeHead(200, { 'content-type': types[extname(target)] || 'text/plain', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'" });
    if (request.method === 'HEAD') response.end(); else response.end(file);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Stockroom: http://127.0.0.1:${port}`));
