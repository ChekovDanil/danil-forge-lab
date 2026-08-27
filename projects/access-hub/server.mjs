import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AccessHub, MemoryStore, ROLE_PERMISSIONS } from './src/index.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const publicRoot = join(root, 'public');
const port = Number(process.env.PORT ?? 3080);
const DEMO_PASSWORD = 'local access demo password';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const headers = {
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff'
};

let store;
let hub;
let owner;
let ready;

async function resetDemo() {
  store = new MemoryStore();
  hub = new AccessHub({ store, scryptCost: 1024, maxLoginFailures: 3, lockoutMs: 15 * 60_000 });
  owner = await hub.register({ email: 'owner@studio.local', password: DEMO_PASSWORD });
  const invitation = await hub.inviteUser({ actorId: owner.id, email: 'editor@studio.local', role: 'editor' });
  await hub.acceptInvitation({ token: invitation.token, password: DEMO_PASSWORD });
  await hub.register({ email: 'viewer@studio.local', password: DEMO_PASSWORD });
}

function state() {
  const users = [...store.users.values()].map((user) => ({
    id: user.id,
    email: user.email,
    role: user.role,
    lockedUntil: user.lockedUntil ? new Date(user.lockedUntil).toISOString() : null,
    permissions: ROLE_PERMISSIONS[user.role]
  }));
  return {
    users,
    ownerId: owner.id,
    audit: hub.getAuditLog(owner.id).slice().reverse(),
    policy: ROLE_PERMISSIONS,
    boundary: 'Local in-memory demo · no sessions · resets on server restart'
  };
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20_000) throw new Error('PAYLOAD_TOO_LARGE');
  }
  return body ? JSON.parse(body) : {};
}

async function runAction(input) {
  const target = store.users.get(input.targetId) ?? [...store.users.values()].find((user) => user.role === 'viewer') ?? owner;
  if (input.action === 'reset') {
    await resetDemo();
    return { tone: 'neutral', title: 'Демо возвращено в исходное состояние', detail: 'Owner, editor и viewer снова готовы к проверке.' };
  }
  if (input.action === 'lockout') {
    let code = '';
    for (let index = 0; index < 3; index += 1) {
      try { await hub.login({ email: target.email, password: 'wrong demo password' }); } catch (error) { code = error.code; }
    }
    try { await hub.login({ email: target.email, password: DEMO_PASSWORD }); } catch (error) { code = error.code; }
    return { tone: 'denied', title: 'Вход временно заблокирован', detail: `${target.email} · три неверные попытки`, code };
  }
  if (input.action === 'recovery') {
    const token = await hub.createRecoveryToken(target.email);
    await hub.resetPassword({ token, newPassword: DEMO_PASSWORD });
    let replayCode = '';
    try { await hub.resetPassword({ token, newPassword: DEMO_PASSWORD }); } catch (error) { replayCode = error.code; }
    return { tone: 'allowed', title: 'Доступ восстановлен', detail: 'Одноразовый token использован и больше не действует.', code: replayCode };
  }
  if (input.action === 'invite') {
    const email = String(input.email ?? `member-${store.users.size + 1}@studio.local`).trim();
    const role = ['editor', 'viewer'].includes(input.role) ? input.role : 'viewer';
    const invitation = await hub.inviteUser({ actorId: owner.id, email, role });
    const user = await hub.acceptInvitation({ token: invitation.token, password: DEMO_PASSWORD });
    let replayCode = '';
    try { await hub.acceptInvitation({ token: invitation.token, password: DEMO_PASSWORD }); } catch (error) { replayCode = error.code; }
    return { tone: 'allowed', title: 'Участник добавлен', detail: `${user.email} · ${user.role}; повторное принятие отклонено`, code: replayCode };
  }
  if (input.action === 'promote') {
    const user = await hub.changeRole({ actorId: owner.id, userId: target.id, role: target.role === 'viewer' ? 'editor' : 'viewer' });
    return { tone: 'allowed', title: 'Роль обновлена', detail: `${user.email} · теперь ${user.role}`, code: 'POLICY_APPLIED' };
  }
  if (input.action === 'last-owner') {
    try { await hub.changeRole({ actorId: owner.id, userId: owner.id, role: 'editor' }); }
    catch (error) { return { tone: 'denied', title: 'Изменение отклонено', detail: 'Последний owner сохраняет управление пространством.', code: error.code }; }
  }
  if (input.action === 'unknown-recovery') {
    const token = await hub.createRecoveryToken('unknown@studio.local');
    let code = '';
    try { await hub.resetPassword({ token, newPassword: DEMO_PASSWORD }); } catch (error) { code = error.code; }
    return { tone: 'neutral', title: 'Ответ не раскрывает аккаунт', detail: 'Для неизвестного email возвращается такой же внешний ответ.', code };
  }
  throw new Error('UNKNOWN_ACTION');
}

ready = resetDemo();

createServer(async (request, response) => {
  await ready;
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/api/state' && request.method === 'GET') {
    response.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(state()));
    return;
  }
  if (url.pathname === '/api/action' && request.method === 'POST') {
    try {
      const result = await runAction(await readJson(request));
      response.writeHead(200, { ...headers, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify({ result, state: state() }));
    } catch (error) {
      response.writeHead(400, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: error.code ?? error.message ?? 'ACTION_FAILED' }));
    }
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    response.writeHead(404, headers);
    response.end('Not found');
    return;
  }
  if (!['GET', 'HEAD'].includes(request.method ?? 'GET')) {
    response.writeHead(405, { ...headers, Allow: 'GET, HEAD' });
    response.end();
    return;
  }
  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^[/\\]+/, '');
  const file = normalize(join(publicRoot, relative));
  if (!file.startsWith(publicRoot) || !existsSync(file) || !statSync(file).isFile()) {
    response.writeHead(404, headers);
    response.end('Not found');
    return;
  }
  response.writeHead(200, { ...headers, 'Content-Type': types[extname(file)] ?? 'application/octet-stream' });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`Access Hub Decision Lab: http://127.0.0.1:${port}`));
