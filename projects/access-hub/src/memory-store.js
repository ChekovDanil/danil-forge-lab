export class MemoryStore {
  users = new Map();
  userIdsByEmail = new Map();
  recoveryTokens = new Map();
  invitations = new Map();
  auditEvents = [];

  async transaction(operation) {
    return operation(this);
  }
}
