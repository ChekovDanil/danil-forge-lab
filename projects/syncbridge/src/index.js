import { createHash, randomUUID } from 'node:crypto';
import { SyncBridgeError, RetryableSyncError } from './errors.js';
import { MemoryJournal, MemorySource, MemoryTarget } from './memory-adapters.js';

const BUILTIN_TRANSFORMS = Object.freeze({
  trim: (value) => typeof value === 'string' ? value.trim() : value,
  lowercase: (value) => typeof value === 'string' ? value.toLowerCase() : value,
  uppercase: (value) => typeof value === 'string' ? value.toUpperCase() : value,
  string: (value) => value === undefined || value === null ? value : String(value),
  number: (value) => value === undefined || value === null || value === '' ? value : Number(value),
  digits: (value) => value === undefined || value === null ? value : String(value).replace(/\D/g, '')
});

function getPath(record, path) {
  return String(path).split('.').reduce((value, key) => value?.[key], record);
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function normalizeDescriptor(descriptor) {
  if (typeof descriptor === 'string') return { from: descriptor, transforms: [] };
  if (!descriptor || typeof descriptor !== 'object' || typeof descriptor.from !== 'string') {
    throw new SyncBridgeError('INVALID_MAPPING', 'Every mapping must be a source path or a descriptor with a from field');
  }
  const transforms = descriptor.transforms ?? (descriptor.transform ? [descriptor.transform] : []);
  return { ...descriptor, transforms: Array.isArray(transforms) ? transforms : [transforms] };
}

function applyTransforms(value, transforms, customTransforms) {
  return transforms.reduce((current, name) => {
    const transform = customTransforms[name] ?? BUILTIN_TRANSFORMS[name];
    if (typeof transform !== 'function') throw new SyncBridgeError('UNKNOWN_TRANSFORM', `Unknown transform: ${name}`);
    return transform(current);
  }, value);
}

function safeError(error) {
  return { code: error?.code ?? 'UNEXPECTED_ERROR', message: error instanceof Error ? error.message : String(error), retryable: error?.retryable === true };
}

export class SyncBridge {
  constructor({ source, target, journal = new MemoryJournal(), sourceIdField = 'id', maxAttempts = 3, retryBaseMs = 250, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => new Date(), customTransforms = {} } = {}) {
    if (!source?.list || !target?.upsert) throw new SyncBridgeError('INVALID_ADAPTER', 'Source.list and target.upsert adapters are required');
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new SyncBridgeError('INVALID_RETRY_POLICY', 'maxAttempts must be a positive integer');
    this.source = source;
    this.target = target;
    this.journal = journal;
    this.sourceIdField = sourceIdField;
    this.maxAttempts = maxAttempts;
    this.retryBaseMs = retryBaseMs;
    this.sleep = sleep;
    this.now = now;
    this.customTransforms = customTransforms;
  }

  mapRecord(record, { fields, required = [] }) {
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) throw new SyncBridgeError('INVALID_MAPPING', 'Mapping fields are required');
    const payload = {};
    for (const [targetField, rawDescriptor] of Object.entries(fields)) {
      const descriptor = normalizeDescriptor(rawDescriptor);
      let value = getPath(record, descriptor.from);
      if ((value === undefined || value === null || value === '') && Object.hasOwn(descriptor, 'default')) value = descriptor.default;
      payload[targetField] = applyTransforms(value, descriptor.transforms, this.customTransforms);
    }
    const missing = required.filter((field) => payload[field] === undefined || payload[field] === null || payload[field] === '');
    if (missing.length) throw new SyncBridgeError('REQUIRED_FIELD_MISSING', `Required mapped fields are missing: ${missing.join(', ')}`, { fields: missing });
    return payload;
  }

  idempotencyKey(sourceId, payload, mappingVersion) {
    return createHash('sha256').update(stable({ source: this.source.name, target: this.target.name, sourceId, mappingVersion, payload })).digest('hex');
  }

  async run({ mapping, mappingVersion = '1', dryRun = false, batchId = randomUUID() } = {}) {
    if (!mapping) throw new SyncBridgeError('INVALID_MAPPING', 'A mapping configuration is required');
    const records = await this.source.list();
    if (!Array.isArray(records)) throw new SyncBridgeError('INVALID_SOURCE_RESULT', 'Source.list must return an array');
    const report = { batchId, dryRun, total: records.length, previewed: 0, succeeded: 0, skipped: 0, failed: 0, created: 0, updated: 0, items: [] };

    for (const record of records) {
      const sourceId = getPath(record, this.sourceIdField);
      if (sourceId === undefined || sourceId === null || sourceId === '') {
        const error = { code: 'MISSING_SOURCE_ID', message: `Source record has no ${this.sourceIdField}`, retryable: false };
        report.failed += 1;
        report.items.push({ sourceId: null, status: 'failed', error });
        await this.journal.append({ batchId, sourceId: null, status: 'failed', error, at: this.now().toISOString() });
        continue;
      }

      let payload;
      try {
        payload = this.mapRecord(record, mapping);
      } catch (error) {
        const serialized = safeError(error);
        report.failed += 1;
        report.items.push({ sourceId, status: 'failed', error: serialized });
        await this.journal.append({ batchId, sourceId, status: 'failed', error: serialized, at: this.now().toISOString() });
        continue;
      }

      const idempotencyKey = this.idempotencyKey(sourceId, payload, mappingVersion);
      if (dryRun) {
        report.previewed += 1;
        report.items.push({ sourceId, status: 'previewed', payload, idempotencyKey });
        await this.journal.append({ batchId, sourceId, idempotencyKey, status: 'previewed', payload, at: this.now().toISOString() });
        continue;
      }
      if (await this.journal.hasSucceeded(idempotencyKey)) {
        report.skipped += 1;
        report.items.push({ sourceId, status: 'skipped', idempotencyKey });
        await this.journal.append({ batchId, sourceId, idempotencyKey, status: 'skipped', reason: 'already_synchronized', at: this.now().toISOString() });
        continue;
      }

      let completed = false;
      for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
        try {
          const receipt = await this.target.upsert(payload, { idempotencyKey, sourceId });
          report.succeeded += 1;
          if (receipt.action === 'created') report.created += 1;
          if (receipt.action === 'updated') report.updated += 1;
          report.items.push({ sourceId, status: 'succeeded', attempts: attempt, receipt, idempotencyKey });
          await this.journal.append({ batchId, sourceId, idempotencyKey, status: 'succeeded', attempt, receipt, at: this.now().toISOString() });
          completed = true;
          break;
        } catch (error) {
          const serialized = safeError(error);
          await this.journal.append({ batchId, sourceId, idempotencyKey, status: 'attempt_failed', attempt, error: serialized, at: this.now().toISOString() });
          if (serialized.retryable && attempt < this.maxAttempts) {
            await this.sleep(this.retryBaseMs * (2 ** (attempt - 1)));
            continue;
          }
          report.failed += 1;
          report.items.push({ sourceId, status: 'failed', attempts: attempt, error: serialized, idempotencyKey });
          completed = true;
          break;
        }
      }
      if (!completed) throw new SyncBridgeError('INTERNAL_STATE', 'Record ended without a terminal state');
    }
    return report;
  }
}

export { SyncBridgeError, RetryableSyncError, MemoryJournal, MemorySource, MemoryTarget, BUILTIN_TRANSFORMS };
