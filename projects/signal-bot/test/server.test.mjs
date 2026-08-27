import assert from 'node:assert/strict';
import test from 'node:test';
import { createSignalServer } from '../server.mjs';

async function withServer(run) {
  const server = createSignalServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try { await run(`http://127.0.0.1:${port}`); }
  finally { await new Promise((resolve) => server.close(resolve)); }
}

test('API returns state and runs critical scenario', () => withServer(async (base) => {
  const initial = await fetch(`${base}/api/state`).then((response) => response.json());
  assert.equal(initial.services.length, 3);
  const response = await fetch(`${base}/api/scenario`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'critical' }) });
  assert.equal(response.status, 200);
  const state = await response.json();
  assert.equal(state.incidents.length, 1);
  assert.equal(state.incidents[0].checks, 2);
  assert.equal(state.messages[0].delivery, 'grouped');
}));

test('API acknowledges an incident and serves the UI', () => withServer(async (base) => {
  await fetch(`${base}/api/scenario`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'critical' }) });
  const response = await fetch(`${base}/api/incidents/INC-001/ack`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ by: 'Вы' }) });
  const state = await response.json();
  assert.equal(state.incidents[0].state, 'acknowledged');
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Signal Bot — мониторинг без шума/);
}));

test('API rejects unknown scenarios and unsafe paths', () => withServer(async (base) => {
  const invalid = await fetch(`${base}/api/scenario`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'unknown' }) });
  assert.equal(invalid.status, 400);
  const missing = await fetch(`${base}/..%2Fpackage.json`);
  assert.equal(missing.status, 404);
}));
