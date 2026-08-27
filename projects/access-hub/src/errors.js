export class AccessHubError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AccessHubError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
