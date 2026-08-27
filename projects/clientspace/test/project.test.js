import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalSummary, canPublish, canRequestChanges, deadlineState, financeSummary, projectProgress, sortActivity, updateApproval } from '../src/project.js';

test('считает обычный и взвешенный прогресс', () => {
  assert.equal(projectProgress([{ status: 'done' }, { status: 'active' }, { status: 'done' }]), 67);
  assert.equal(projectProgress([{ weight: 40, progress: 100 }, { weight: 60, progress: 50 }]), 70);
});

test('согласование разрешает клиентские и командные переходы', () => {
  const source = [{ id: '1', status: 'pending' }];
  const changes = updateApproval(source, '1', 'changes_requested', 'Исправить навигацию');
  assert.equal(changes[0].status, 'changes_requested');
  const resubmitted = updateApproval(changes, '1', 'pending', changes[0].note);
  assert.equal(resubmitted[0].status, 'pending');
  const approved = updateApproval(resubmitted, '1', 'approved');
  assert.equal(approved[0].status, 'approved');
  assert.equal(source[0].status, 'pending');
  assert.throws(() => updateApproval(approved, '1', 'pending'), /Недопустимый/);
});

test('считает счета по состояниям', () => assert.deepEqual(financeSummary([{ amount: 50, status: 'paid' }, { amount: 25, status: 'due' }, { amount: 10, status: 'draft' }]), { total: 85, paid: 50, due: 25 }));
test('новые события поднимаются выше', () => assert.equal(sortActivity([{ id: 'old', at: '2026-01-01' }, { id: 'new', at: '2026-02-01' }])[0].id, 'new'));

test('определяет близкий и просроченный срок', () => {
  const now = new Date('2026-08-27T10:00:00Z');
  assert.equal(deadlineState('2026-08-27T14:00:00Z', now).state, 'soon');
  assert.equal(deadlineState('2026-08-26T10:00:00Z', now).state, 'overdue');
  assert.equal(deadlineState('2026-08-30T10:00:00Z', now).state, 'normal');
});

test('сводка решений не теряет просрочку', () => {
  const now = new Date('2026-08-27T10:00:00Z');
  const summary = approvalSummary([{ status: 'pending', dueAt: '2026-08-26T10:00:00Z' }, { status: 'approved', dueAt: '2026-08-25T10:00:00Z' }], now);
  assert.deepEqual(summary, { pending: 1, approved: 1, overdue: 1 });
});

test('правки требуют содержательного комментария', () => {
  assert.equal(canRequestChanges('коротко'), false);
  assert.equal(canRequestChanges('Исправить порядок экранов'), true);
});

test('согласовать можно только ожидающую версию с файлом', () => {
  assert.equal(canPublish({ status: 'pending', fileUrl: '/a' }), true);
  assert.equal(canPublish({ status: 'approved', fileUrl: '/a' }), false);
  assert.equal(canPublish({ status: 'pending', fileUrl: '' }), false);
});
