import { RetryableSyncError, SyncBridgeError } from './errors.js';

function copy(value) {
  return structuredClone(value);
}

export class MemorySource {
  constructor(records = [], { name = 'memory-source' } = {}) {
    this.name = name;
    this.records = records.map(copy);
  }

  async list() {
    return this.records.map(copy);
  }
}

export class MemoryTarget {
  constructor({ name = 'memory-target', keyField = 'id', initialRecords = [], failures = {} } = {}) {
    this.name = name;
    this.keyField = keyField;
    this.records = new Map(initialRecords.map((record) => [String(record[keyField]), copy(record)]));
    this.receipts = new Map();
    this.calls = [];
    this.failures = new Map(Object.entries(failures).map(([key, value]) => [key, { ...value }]));
  }

  async upsert(payload, { idempotencyKey } = {}) {
    if (!idempotencyKey) throw new SyncBridgeError('MISSING_IDEMPOTENCY_KEY', 'Target write requires an idempotency key');
    if (this.receipts.has(idempotencyKey)) return copy(this.receipts.get(idempotencyKey));
    const key = payload[this.keyField];
    if (key === undefined || key === null || key === '') {
      throw new SyncBridgeError('MISSING_TARGET_KEY', `Mapped payload must include ${this.keyField}`);
    }
    const normalizedKey = String(key);
    this.calls.push({ payload: copy(payload), idempotencyKey });
    const configuredFailure = this.failures.get(normalizedKey);
    if (configuredFailure?.times > 0) {
      configuredFailure.times -= 1;
      if (configuredFailure.retryable) throw new RetryableSyncError(configuredFailure.message ?? 'Temporary target failure');
      throw new SyncBridgeError('TARGET_REJECTED', configuredFailure.message ?? 'Target rejected the record');
    }
    const action = this.records.has(normalizedKey) ? 'updated' : 'created';
    const stored = copy(payload);
    this.records.set(normalizedKey, stored);
    const receipt = { action, key: normalizedKey, record: stored };
    this.receipts.set(idempotencyKey, receipt);
    return copy(receipt);
  }

  values() {
    return [...this.records.values()].map(copy);
  }
}

export class MemoryJournal {
  constructor() {
    this.entries = [];
    this.successfulKeys = new Set();
  }

  async append(entry) {
    const snapshot = copy(entry);
    this.entries.push(snapshot);
    if (snapshot.status === 'succeeded') this.successfulKeys.add(snapshot.idempotencyKey);
    return copy(snapshot);
  }

  async hasSucceeded(idempotencyKey) {
    return this.successfulKeys.has(idempotencyKey);
  }

  list() {
    return this.entries.map(copy);
  }
}
