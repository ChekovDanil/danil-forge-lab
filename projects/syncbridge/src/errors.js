export class SyncBridgeError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SyncBridgeError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export class RetryableSyncError extends SyncBridgeError {
  constructor(message, details = undefined) {
    super('RETRYABLE_TARGET_ERROR', message, details);
    this.name = 'RetryableSyncError';
    this.retryable = true;
  }
}
