import assert from 'node:assert/strict';
import test from 'node:test';
import { createJobId, matchesFilter, needsAttention, nextStatus } from '../app/domain.ts';

test('status pipeline skips no operational step', () => {
  assert.equal(nextStatus('Новая'), 'Назначена');
  assert.equal(nextStatus('Назначена'), 'В работе');
  assert.equal(nextStatus('Ожидает'), 'В работе');
  assert.equal(nextStatus('В работе'), 'Завершена');
  assert.equal(nextStatus('Завершена'), 'Завершена');
});

test('attention queue excludes completed work', () => {
  assert.equal(needsAttention({ status: 'Новая', sla: 'critical' }), true);
  assert.equal(needsAttention({ status: 'Завершена', sla: 'critical' }), false);
  assert.equal(needsAttention({ status: 'В работе', sla: 'normal' }), false);
});

test('filters match the dispatcher mental model', () => {
  assert.equal(matchesFilter({ status: 'Новая', sla: 'normal' }, 'Новые'), true);
  assert.equal(matchesFilter({ status: 'Ожидает', sla: 'normal' }, 'Активные'), true);
  assert.equal(matchesFilter({ status: 'В работе', sla: 'risk' }, 'Проблемные'), true);
  assert.equal(matchesFilter({ status: 'Завершена', sla: 'risk' }, 'Проблемные'), false);
});

test('new job id remains stable and readable', () => {
  assert.equal(createJobId(5), 'FD-247');
  assert.equal(createJobId(18), 'FD-260');
});
