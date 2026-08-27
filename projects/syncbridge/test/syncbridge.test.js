import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryJournal, MemorySource, MemoryTarget, RetryableSyncError, SyncBridge, SyncBridgeError } from '../src/index.js';

const mapping = {
  fields: {
    name: { from: 'profile.name', transform: 'trim' },
    email: { from: 'profile.email', transforms: ['trim', 'lowercase'] },
    phone: { from: 'phone', transform: 'digits' },
    segment: { from: 'segment', default: 'new' }
  },
  required: ['name', 'email']
};

function fixture(records, options = {}) {
  const source = new MemorySource(records, { name: 'leads' });
  const target = new MemoryTarget({ name: 'crm', keyField: 'email', ...(options.target ?? {}) });
  const journal = new MemoryJournal();
  const bridge = new SyncBridge({ source, target, journal, retryBaseMs: 10, sleep: options.sleep ?? (async () => {}) });
  return { source, target, journal, bridge };
}

test('maps nested fields, defaults and built-in transforms', () => {
  const { bridge } = fixture([]);
  assert.deepEqual(bridge.mapRecord({ profile: { name: ' Анна ', email: ' A@example.invalid ' }, phone: '+7 (999) 10-20' }, mapping), {
    name: 'Анна', email: 'a@example.invalid', phone: '79991020', segment: 'new'
  });
});

test('dry-run returns mapped payloads without writing to the target', async () => {
  const { bridge, target, journal } = fixture([{ id: '1', profile: { name: 'Анна', email: 'A@example.invalid' }, phone: '123' }]);
  const report = await bridge.run({ mapping, dryRun: true, batchId: 'preview' });
  assert.equal(report.previewed, 1);
  assert.equal(report.succeeded, 0);
  assert.equal(target.values().length, 0);
  assert.equal(journal.list()[0].status, 'previewed');
});

test('creates mapped target records and reports actions', async () => {
  const { bridge, target } = fixture([
    { id: '1', profile: { name: 'Анна', email: 'a@example.invalid' }, phone: '111' },
    { id: '2', profile: { name: 'Илья', email: 'i@example.invalid' }, phone: '222' }
  ]);
  const report = await bridge.run({ mapping });
  assert.equal(report.succeeded, 2);
  assert.equal(report.created, 2);
  assert.deepEqual(target.values().map((record) => record.email).sort(), ['a@example.invalid', 'i@example.invalid']);
});

test('skips records already synchronized with the same mapped payload', async () => {
  const { bridge, target } = fixture([{ id: '1', profile: { name: 'Анна', email: 'a@example.invalid' }, phone: '111' }]);
  assert.equal((await bridge.run({ mapping })).succeeded, 1);
  const repeated = await bridge.run({ mapping });
  assert.equal(repeated.skipped, 1);
  assert.equal(target.calls.length, 1);
});

test('synchronizes a changed payload as an update instead of treating it as a duplicate', async () => {
  const { bridge, source, target } = fixture([{ id: '1', profile: { name: 'Анна', email: 'a@example.invalid' }, phone: '111' }]);
  await bridge.run({ mapping });
  source.records[0].profile.name = 'Анна Петрова';
  const changed = await bridge.run({ mapping });
  assert.equal(changed.updated, 1);
  assert.equal(target.values()[0].name, 'Анна Петрова');
});

test('retries a temporary target error with exponential delays', async () => {
  const delays = [];
  const { bridge, target, journal } = fixture(
    [{ id: '1', profile: { name: 'Анна', email: 'a@example.invalid' }, phone: '111' }],
    { target: { failures: { 'a@example.invalid': { times: 2, retryable: true } } }, sleep: async (ms) => delays.push(ms) }
  );
  const report = await bridge.run({ mapping });
  assert.equal(report.succeeded, 1);
  assert.equal(report.items[0].attempts, 3);
  assert.deepEqual(delays, [10, 20]);
  assert.equal(target.calls.length, 3);
  assert.equal(journal.list().filter((entry) => entry.status === 'attempt_failed').length, 2);
});

test('continues the batch after a permanent record failure', async () => {
  const { bridge, target } = fixture([
    { id: 'bad', profile: { name: 'Ошибка', email: 'bad@example.invalid' }, phone: '111' },
    { id: 'good', profile: { name: 'Готово', email: 'good@example.invalid' }, phone: '222' }
  ], { target: { failures: { 'bad@example.invalid': { times: 1, retryable: false, message: 'CRM validation failed' } } } });
  const report = await bridge.run({ mapping });
  assert.equal(report.failed, 1);
  assert.equal(report.succeeded, 1);
  assert.equal(target.values()[0].email, 'good@example.invalid');
});

test('reports required-field and source-id errors without stopping valid records', async () => {
  const { bridge, target } = fixture([
    { id: 'missing-email', profile: { name: 'Нет почты' } },
    { profile: { name: 'Нет ID', email: 'id@example.invalid' } },
    { id: 'valid', profile: { name: 'Готово', email: 'ok@example.invalid' } }
  ]);
  const report = await bridge.run({ mapping });
  assert.equal(report.failed, 2);
  assert.equal(report.succeeded, 1);
  assert.deepEqual(report.items.filter((item) => item.status === 'failed').map((item) => item.error.code).sort(), ['MISSING_SOURCE_ID', 'REQUIRED_FIELD_MISSING']);
  assert.equal(target.values()[0].email, 'ok@example.invalid');
});

test('supports custom transforms while rejecting unknown transform names', () => {
  const { source, target, journal } = fixture([]);
  const bridge = new SyncBridge({ source, target, journal, customTransforms: { prefix: (value) => `CRM-${value}` } });
  assert.deepEqual(bridge.mapRecord({ id: '42' }, { fields: { externalId: { from: 'id', transform: 'prefix' } } }), { externalId: 'CRM-42' });
  assert.throws(() => bridge.mapRecord({ id: '42' }, { fields: { externalId: { from: 'id', transform: 'missing' } } }), { code: 'UNKNOWN_TRANSFORM' });
});

test('validates adapters and retry policy at construction time', () => {
  assert.throws(() => new SyncBridge(), { code: 'INVALID_ADAPTER' });
  const source = new MemorySource([]);
  const target = new MemoryTarget();
  assert.throws(() => new SyncBridge({ source, target, maxAttempts: 0 }), { code: 'INVALID_RETRY_POLICY' });
  assert.equal(new RetryableSyncError('temporary').retryable, true);
  assert.equal(new SyncBridgeError('EXAMPLE', 'Example').code, 'EXAMPLE');
});
