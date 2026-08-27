import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessHub, AccessHubError, MemoryStore, normalizeEmail } from '../src/index.js';

const PASSWORD = 'correct horse battery staple';

test('normalizes email and rejects malformed addresses', () => {
  assert.equal(normalizeEmail('  Alice@Example.COM '), 'alice@example.com');
  assert.throws(() => normalizeEmail('not-an-email'), { code: 'INVALID_EMAIL' });
});

test('registers the first user as owner and does not expose credentials', async () => {
  const hub = new AccessHub({ scryptCost: 1024 });
  const user = await hub.register({ email: 'Owner@Example.com', password: PASSWORD });
  assert.equal(user.email, 'owner@example.com');
  assert.equal(user.role, 'owner');
  assert.deepEqual(Object.keys(user).sort(), ['createdAt', 'email', 'id', 'role']);
});

test('stores a salted scrypt digest rather than the password', async () => {
  const store = new MemoryStore();
  const hub = new AccessHub({ store, scryptCost: 1024 });
  const user = await hub.register({ email: 'owner@example.com', password: PASSWORD });
  const internal = store.users.get(user.id);
  assert.notEqual(internal.passwordHash, PASSWORD);
  assert.equal(internal.passwordHash.length, 128);
  assert.equal(internal.passwordSalt.length, 32);
});

test('uses an independent salt for every account even with the same password', async () => {
  const store = new MemoryStore();
  const hub = new AccessHub({ store, scryptCost: 1024 });
  const first = await hub.register({ email: 'first@example.com', password: PASSWORD });
  const second = await hub.register({ email: 'second@example.com', password: PASSWORD });
  const firstCredential = store.users.get(first.id);
  const secondCredential = store.users.get(second.id);
  assert.notEqual(firstCredential.passwordSalt, secondCredential.passwordSalt);
  assert.notEqual(firstCredential.passwordHash, secondCredential.passwordHash);
});

test('logs in with valid credentials and rejects duplicate registration', async () => {
  const hub = new AccessHub({ scryptCost: 1024 });
  const registered = await hub.register({ email: 'owner@example.com', password: PASSWORD });
  assert.equal((await hub.login({ email: 'OWNER@example.com', password: PASSWORD })).id, registered.id);
  await assert.rejects(() => hub.register({ email: ' owner@example.com ', password: PASSWORD }), { code: 'EMAIL_IN_USE' });
});

test('locks an account after repeated failures and unlocks after the window', async () => {
  let now = 1_000;
  const hub = new AccessHub({ now: () => now, maxLoginFailures: 2, lockoutMs: 5_000, scryptCost: 1024 });
  await hub.register({ email: 'owner@example.com', password: PASSWORD });
  await assert.rejects(() => hub.login({ email: 'owner@example.com', password: 'wrong' }), { code: 'INVALID_CREDENTIALS' });
  await assert.rejects(() => hub.login({ email: 'owner@example.com', password: 'wrong' }), { code: 'INVALID_CREDENTIALS' });
  await assert.rejects(() => hub.login({ email: 'owner@example.com', password: PASSWORD }), { code: 'ACCOUNT_LOCKED' });
  now += 5_001;
  assert.equal((await hub.login({ email: 'owner@example.com', password: PASSWORD })).email, 'owner@example.com');
});

test('uses one-time recovery tokens and supports expiration', async () => {
  let now = 10_000;
  const hub = new AccessHub({ now: () => now, recoveryTtlMs: 100, scryptCost: 1024 });
  await hub.register({ email: 'owner@example.com', password: PASSWORD });
  const token = await hub.createRecoveryToken('owner@example.com');
  await hub.resetPassword({ token, newPassword: 'a completely new secure password' });
  await assert.rejects(() => hub.resetPassword({ token, newPassword: PASSWORD }), { code: 'INVALID_RECOVERY_TOKEN' });
  assert.equal((await hub.login({ email: 'owner@example.com', password: 'a completely new secure password' })).email, 'owner@example.com');
  const expired = await hub.createRecoveryToken('owner@example.com');
  now += 101;
  await assert.rejects(() => hub.resetPassword({ token: expired, newPassword: PASSWORD }), { code: 'INVALID_RECOVERY_TOKEN' });
});

test('returns an indistinguishable recovery token for an unknown email', async () => {
  const hub = new AccessHub({ scryptCost: 1024 });
  const token = await hub.createRecoveryToken('missing@example.com');
  assert.equal(typeof token, 'string');
  await assert.rejects(() => hub.resetPassword({ token, newPassword: PASSWORD }), { code: 'INVALID_RECOVERY_TOKEN' });
});

test('owner can invite an editor and invitation is one-time', async () => {
  const hub = new AccessHub({ scryptCost: 1024 });
  const owner = await hub.register({ email: 'owner@example.com', password: PASSWORD });
  const invitation = await hub.inviteUser({ actorId: owner.id, email: ' Editor@Example.com ', role: 'editor' });
  const editor = await hub.acceptInvitation({ token: invitation.token, password: PASSWORD });
  assert.equal(editor.email, 'editor@example.com');
  assert.equal(editor.role, 'editor');
  await assert.rejects(() => hub.acceptInvitation({ token: invitation.token, password: PASSWORD }), { code: 'INVALID_INVITATION' });
});

test('rejects an expired invitation', async () => {
  let now = 50_000;
  const hub = new AccessHub({ now: () => now, invitationTtlMs: 100, scryptCost: 1024 });
  const owner = await hub.register({ email: 'owner@example.com', password: PASSWORD });
  const invitation = await hub.inviteUser({ actorId: owner.id, email: 'late@example.com', role: 'viewer' });
  now += 101;
  await assert.rejects(() => hub.acceptInvitation({ token: invitation.token, password: PASSWORD }), { code: 'INVALID_INVITATION' });
});

test('enforces role permissions and protects the last owner', async () => {
  const hub = new AccessHub({ scryptCost: 1024 });
  const owner = await hub.register({ email: 'owner@example.com', password: PASSWORD });
  const viewer = await hub.register({ email: 'viewer@example.com', password: PASSWORD });
  assert.equal(hub.hasPermission(viewer.id, 'content:read'), true);
  assert.equal(hub.hasPermission(viewer.id, 'content:write'), false);
  assert.throws(() => hub.requirePermission(viewer.id, 'users:invite'), { code: 'FORBIDDEN' });
  await assert.rejects(() => hub.changeRole({ actorId: owner.id, userId: owner.id, role: 'editor' }), { code: 'LAST_OWNER' });
  assert.equal((await hub.changeRole({ actorId: owner.id, userId: viewer.id, role: 'editor' })).role, 'editor');
});

test('prevents a viewer from inviting users or reading the audit log', async () => {
  const hub = new AccessHub({ scryptCost: 1024 });
  await hub.register({ email: 'owner@example.com', password: PASSWORD });
  const viewer = await hub.register({ email: 'viewer@example.com', password: PASSWORD });
  await assert.rejects(() => hub.inviteUser({ actorId: viewer.id, email: 'intruder@example.com', role: 'owner' }), { code: 'FORBIDDEN' });
  assert.throws(() => hub.getAuditLog(viewer.id), { code: 'FORBIDDEN' });
});

test('audit records outcomes without passwords, hashes or raw tokens', async () => {
  const hub = new AccessHub({ scryptCost: 1024, maxLoginFailures: 1 });
  const owner = await hub.register({ email: 'owner@example.com', password: PASSWORD });
  const recoveryToken = await hub.createRecoveryToken(owner.email);
  const invitation = await hub.inviteUser({ actorId: owner.id, email: 'new@example.com', role: 'viewer' });
  await assert.rejects(() => hub.login({ email: owner.email, password: 'leak-me-not' }));
  const serialized = JSON.stringify(hub.getAuditLog(owner.id));
  assert.doesNotMatch(serialized, /leak-me-not|correct horse|passwordHash|passwordSalt/);
  assert.equal(serialized.includes(recoveryToken), false);
  assert.equal(serialized.includes(invitation.token), false);
  assert.match(serialized, /user\.register/);
  assert.match(serialized, /denied/);
});

test('exports errors with stable machine-readable codes', () => {
  const error = new AccessHubError('EXAMPLE', 'Example');
  assert.equal(error.code, 'EXAMPLE');
  assert.equal(error.name, 'AccessHubError');
});
