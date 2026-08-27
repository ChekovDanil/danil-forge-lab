import assert from 'node:assert/strict';
import test from 'node:test';
import { MonitorEngine, buildScenario } from '../src/monitor-core.mjs';

test('healthy checks do not create incidents', () => {
  const engine = new MonitorEngine();
  const result = engine.applyCheck({ serviceId: 'api', status: 'healthy', latencyMs: 90, at: '2026-08-27T12:00:00Z' });
  assert.equal(result.action, 'none');
  assert.equal(engine.snapshot().incidents.length, 0);
});

test('degraded check creates one warning', () => {
  const engine = new MonitorEngine();
  const result = engine.applyCheck({ serviceId: 'sync', status: 'degraded', latencyMs: 2000, at: '2026-08-27T12:00:00Z' });
  assert.equal(result.action, 'created');
  assert.equal(result.incident.severity, 'warning');
  assert.equal(result.delivery, 'send');
});

test('repeat failures are grouped into the active incident', () => {
  const engine = new MonitorEngine();
  engine.applyCheck({ serviceId: 'api', status: 'down', latencyMs: 10000, at: '2026-08-27T12:00:00Z' });
  const repeat = engine.applyCheck({ serviceId: 'api', status: 'down', latencyMs: 10000, at: '2026-08-27T12:03:00Z' });
  assert.equal(repeat.action, 'grouped');
  assert.equal(repeat.delivery, 'grouped');
  assert.equal(repeat.incident.checks, 2);
  assert.equal(engine.snapshot().incidents.length, 1);
});

test('warning waits for digest during quiet hours', () => {
  const engine = new MonitorEngine();
  const result = engine.applyCheck({ serviceId: 'sync', status: 'degraded', latencyMs: 2200, at: '2026-08-27T23:10:00Z' });
  assert.equal(result.delivery, 'digest');
});

test('critical incident bypasses quiet hours', () => {
  const engine = new MonitorEngine();
  const result = engine.applyCheck({ serviceId: 'api', status: 'down', latencyMs: 10000, at: '2026-08-27T23:10:00Z' });
  assert.equal(result.delivery, 'send');
});

test('muted service does not send a warning', () => {
  const engine = new MonitorEngine();
  engine.mute('payments', 30, '2026-08-27T12:00:00Z');
  const result = engine.applyCheck({ serviceId: 'payments', status: 'degraded', latencyMs: 1900, at: '2026-08-27T12:05:00Z' });
  assert.equal(result.delivery, 'muted');
});

test('acknowledgement records the responsible person', () => {
  const engine = new MonitorEngine();
  const created = engine.applyCheck({ serviceId: 'api', status: 'down', latencyMs: 10000, at: '2026-08-27T12:00:00Z' });
  const result = engine.acknowledge(created.incident.id, 'Алексей', '2026-08-27T12:01:00Z');
  assert.equal(result.incident.state, 'acknowledged');
  assert.equal(result.incident.acknowledgedBy, 'Алексей');
  assert.match(result.message.text, /взял в работу Алексей/);
});

test('healthy recovery resolves an active incident', () => {
  const engine = new MonitorEngine();
  engine.applyCheck({ serviceId: 'api', status: 'down', latencyMs: 10000, at: '2026-08-27T12:00:00Z' });
  const result = engine.applyCheck({ serviceId: 'api', status: 'healthy', latencyMs: 130, at: '2026-08-27T12:06:00Z' });
  assert.equal(result.action, 'resolved');
  assert.equal(result.incident.state, 'resolved');
  assert.match(result.message.text, /Восстановлено/);
});

test('status summary separates critical and warning incidents', () => {
  const engine = new MonitorEngine();
  engine.applyCheck({ serviceId: 'api', status: 'down', latencyMs: 10000, at: '2026-08-27T12:00:00Z' });
  engine.applyCheck({ serviceId: 'sync', status: 'degraded', latencyMs: 2200, at: '2026-08-27T12:01:00Z' });
  assert.equal(engine.statusText(), 'Активных инцидентов: 2. Критических: 1. Требуют проверки: 1.');
});

test('scenario fixtures remain deterministic', () => {
  assert.equal(buildScenario('normal').length, 0);
  assert.equal(buildScenario('quiet').length, 1);
  assert.equal(buildScenario('critical').length, 2);
  assert.throws(() => buildScenario('unknown'), /Unknown scenario/);
});

test('invalid identifiers and mute ranges fail closed', () => {
  const engine = new MonitorEngine();
  assert.throws(() => engine.applyCheck({ serviceId: 'missing', status: 'down', latencyMs: 1 }), /Unknown service/);
  assert.throws(() => engine.mute('api', 0), /between 1 and 1440/);
  assert.throws(() => engine.acknowledge('INC-404'), /not found/);
});
