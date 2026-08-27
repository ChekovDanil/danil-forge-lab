import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { AccessHubError } from './errors.js';
import { MemoryStore } from './memory-store.js';

const scrypt = promisify(scryptCallback);
const ROLES = Object.freeze(['owner', 'editor', 'viewer']);
const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze(['users:invite', 'users:read', 'users:manage', 'content:read', 'content:write', 'audit:read']),
  editor: Object.freeze(['users:read', 'content:read', 'content:write']),
  viewer: Object.freeze(['content:read'])
});
const SECRET_KEYS = /pass(word)?|token|secret|hash|salt/i;

function normalizeEmail(email) {
  if (typeof email !== 'string') throw new AccessHubError('INVALID_EMAIL', 'A valid email is required');
  const normalized = email.trim().toLowerCase().normalize('NFKC');
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new AccessHubError('INVALID_EMAIL', 'A valid email is required');
  }
  return normalized;
}

function assertPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024) {
    throw new AccessHubError('WEAK_PASSWORD', 'Password must contain between 12 and 1024 characters');
  }
}

function publicUser(user) {
  return { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt };
}

function fingerprint(value) {
  return createHash('sha256').update(value).digest('hex');
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[REDACTED]' : redact(item)]));
}

export class AccessHub {
  constructor({ store = new MemoryStore(), now = () => Date.now(), maxLoginFailures = 5, lockoutMs = 15 * 60_000, recoveryTtlMs = 30 * 60_000, invitationTtlMs = 48 * 60 * 60_000, scryptCost = 16_384 } = {}) {
    this.store = store;
    this.now = now;
    this.config = { maxLoginFailures, lockoutMs, recoveryTtlMs, invitationTtlMs, scryptCost };
    this.dummySalt = randomBytes(16).toString('hex');
  }

  async #passwordDigest(password, salt) {
    return Buffer.from(await scrypt(password, salt, 64, { N: this.config.scryptCost, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }));
  }

  async #newCredential(password) {
    assertPassword(password);
    const salt = randomBytes(16).toString('hex');
    return { passwordSalt: salt, passwordHash: (await this.#passwordDigest(password, salt)).toString('hex') };
  }

  async #matches(password, user) {
    const salt = user?.passwordSalt ?? this.dummySalt;
    const expected = user ? Buffer.from(user.passwordHash, 'hex') : Buffer.alloc(64);
    const actual = await this.#passwordDigest(typeof password === 'string' ? password : '', salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual) && Boolean(user);
  }

  async #audit(action, { actorId = null, targetId = null, outcome = 'success', metadata = {} } = {}) {
    const event = Object.freeze({ id: randomUUID(), action, actorId, targetId, outcome, metadata: redact(metadata), at: new Date(this.now()).toISOString() });
    this.store.auditEvents.push(event);
    return event;
  }

  async register({ email, password }) {
    const normalized = normalizeEmail(email);
    const credential = await this.#newCredential(password);
    return this.store.transaction(async (store) => {
      if (store.userIdsByEmail.has(normalized)) {
        await this.#audit('user.register', { outcome: 'denied', metadata: { email: normalized, reason: 'duplicate' } });
        throw new AccessHubError('EMAIL_IN_USE', 'An account with this email already exists');
      }
      const createdAt = new Date(this.now()).toISOString();
      const user = { id: randomUUID(), email: normalized, role: store.users.size === 0 ? 'owner' : 'viewer', ...credential, failedLogins: 0, lockedUntil: null, createdAt };
      store.users.set(user.id, user);
      store.userIdsByEmail.set(normalized, user.id);
      await this.#audit('user.register', { actorId: user.id, targetId: user.id, metadata: { email: normalized, role: user.role } });
      return publicUser(user);
    });
  }

  async login({ email, password }) {
    const normalized = normalizeEmail(email);
    const user = this.store.users.get(this.store.userIdsByEmail.get(normalized));
    const now = this.now();
    if (user?.lockedUntil && user.lockedUntil > now) {
      await this.#audit('user.login', { targetId: user.id, outcome: 'denied', metadata: { reason: 'locked' } });
      throw new AccessHubError('ACCOUNT_LOCKED', 'Account is temporarily locked', { retryAt: new Date(user.lockedUntil).toISOString() });
    }
    const valid = await this.#matches(password, user);
    if (!valid) {
      if (user) {
        user.failedLogins += 1;
        if (user.failedLogins >= this.config.maxLoginFailures) user.lockedUntil = now + this.config.lockoutMs;
      }
      await this.#audit('user.login', { targetId: user?.id, outcome: 'denied', metadata: { reason: 'invalid_credentials' } });
      throw new AccessHubError('INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    user.failedLogins = 0;
    user.lockedUntil = null;
    await this.#audit('user.login', { actorId: user.id, targetId: user.id });
    return publicUser(user);
  }

  async createRecoveryToken(email) {
    const normalized = normalizeEmail(email);
    const user = this.store.users.get(this.store.userIdsByEmail.get(normalized));
    const token = randomBytes(32).toString('base64url');
    if (!user) {
      await this.#audit('recovery.request', { metadata: { email: normalized } });
      return token;
    }
    const tokenHash = fingerprint(token);
    this.store.recoveryTokens.set(tokenHash, { userId: user.id, expiresAt: this.now() + this.config.recoveryTtlMs });
    await this.#audit('recovery.request', { targetId: user.id, metadata: { email: normalized } });
    return token;
  }

  async resetPassword({ token, newPassword }) {
    assertPassword(newPassword);
    const tokenHash = fingerprint(typeof token === 'string' ? token : '');
    const record = this.store.recoveryTokens.get(tokenHash);
    if (!record || record.expiresAt <= this.now()) {
      if (record) this.store.recoveryTokens.delete(tokenHash);
      await this.#audit('recovery.consume', { outcome: 'denied', metadata: { reason: 'invalid_or_expired' } });
      throw new AccessHubError('INVALID_RECOVERY_TOKEN', 'Recovery token is invalid or expired');
    }
    this.store.recoveryTokens.delete(tokenHash);
    const user = this.store.users.get(record.userId);
    Object.assign(user, await this.#newCredential(newPassword), { failedLogins: 0, lockedUntil: null });
    await this.#audit('recovery.consume', { actorId: user.id, targetId: user.id });
    return publicUser(user);
  }

  async inviteUser({ actorId, email, role = 'viewer' }) {
    this.requirePermission(actorId, 'users:invite');
    if (!ROLES.includes(role)) throw new AccessHubError('INVALID_ROLE', `Role must be one of: ${ROLES.join(', ')}`);
    const normalized = normalizeEmail(email);
    if (this.store.userIdsByEmail.has(normalized)) throw new AccessHubError('EMAIL_IN_USE', 'An account with this email already exists');
    const token = randomBytes(32).toString('base64url');
    this.store.invitations.set(fingerprint(token), { email: normalized, role, invitedBy: actorId, expiresAt: this.now() + this.config.invitationTtlMs });
    await this.#audit('invitation.create', { actorId, metadata: { email: normalized, role } });
    return { token, email: normalized, role, expiresAt: new Date(this.now() + this.config.invitationTtlMs).toISOString() };
  }

  async acceptInvitation({ token, password }) {
    assertPassword(password);
    const tokenHash = fingerprint(typeof token === 'string' ? token : '');
    const invitation = this.store.invitations.get(tokenHash);
    if (!invitation || invitation.expiresAt <= this.now()) {
      if (invitation) this.store.invitations.delete(tokenHash);
      await this.#audit('invitation.accept', { outcome: 'denied', metadata: { reason: 'invalid_or_expired' } });
      throw new AccessHubError('INVALID_INVITATION', 'Invitation is invalid or expired');
    }
    if (this.store.userIdsByEmail.has(invitation.email)) throw new AccessHubError('EMAIL_IN_USE', 'An account with this email already exists');
    this.store.invitations.delete(tokenHash);
    const user = { id: randomUUID(), email: invitation.email, role: invitation.role, ...(await this.#newCredential(password)), failedLogins: 0, lockedUntil: null, createdAt: new Date(this.now()).toISOString() };
    this.store.users.set(user.id, user);
    this.store.userIdsByEmail.set(user.email, user.id);
    await this.#audit('invitation.accept', { actorId: user.id, targetId: user.id, metadata: { role: user.role, invitedBy: invitation.invitedBy } });
    return publicUser(user);
  }

  hasPermission(userId, permission) {
    const user = this.store.users.get(userId);
    return Boolean(user && ROLE_PERMISSIONS[user.role]?.includes(permission));
  }

  requirePermission(userId, permission) {
    if (!this.hasPermission(userId, permission)) throw new AccessHubError('FORBIDDEN', 'Permission denied', { permission });
    return true;
  }

  async changeRole({ actorId, userId, role }) {
    this.requirePermission(actorId, 'users:manage');
    if (!ROLES.includes(role)) throw new AccessHubError('INVALID_ROLE', `Role must be one of: ${ROLES.join(', ')}`);
    const user = this.store.users.get(userId);
    if (!user) throw new AccessHubError('USER_NOT_FOUND', 'User not found');
    if (user.role === 'owner' && role !== 'owner') {
      const ownerCount = [...this.store.users.values()].filter((candidate) => candidate.role === 'owner').length;
      if (ownerCount === 1) throw new AccessHubError('LAST_OWNER', 'The last owner cannot be demoted');
    }
    const previousRole = user.role;
    user.role = role;
    await this.#audit('user.role_change', { actorId, targetId: userId, metadata: { previousRole, role } });
    return publicUser(user);
  }

  getAuditLog(actorId) {
    this.requirePermission(actorId, 'audit:read');
    return this.store.auditEvents.map((event) => ({ ...event, metadata: structuredClone(event.metadata) }));
  }
}

export { AccessHubError, MemoryStore, ROLES, ROLE_PERMISSIONS, normalizeEmail };
