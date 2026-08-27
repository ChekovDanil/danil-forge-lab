import test from 'node:test';
import assert from 'node:assert/strict';
import { PAGES, applyPlan, auditSummary, clonePages, createCheckpoint, createPlan, rollback, visiblePages } from '../src/content-core.js';

test('fixture is synthetic and has stable unique issue ids', () => {
  const issues = PAGES.flatMap((page) => page.issues);
  assert.equal(PAGES.length, 5);
  assert.equal(issues.length, 6);
  assert.equal(new Set(issues.map((issue) => issue.id)).size, issues.length);
});

test('summarizes open issues by severity and type', () => {
  const summary = auditSummary(PAGES);
  assert.deepEqual(summary, { pages: 5, total: 6, open: 6, fixed: 0, high: 2, byType: { link: 2, meta: 2, media: 2 } });
});

test('filters pages by issue type and clean state', () => {
  assert.deepEqual(visiblePages(PAGES, 'link').map((page) => page.id), ['home', 'delivery']);
  assert.deepEqual(visiblePages(PAGES, 'clean').map((page) => page.id), ['contacts']);
});

test('creates a dry-run plan only for selected open issues', () => {
  const plan = createPlan(PAGES, ['home-link', 'catalog-alt', 'unknown']);
  assert.equal(plan.length, 2);
  assert.ok(plan.every((item) => item.reversible));
  assert.equal(plan[0].action, 'Обновить или отключить ссылку');
});

test('checkpoint is a deep immutable snapshot', () => {
  const pages = clonePages(PAGES);
  const checkpoint = createCheckpoint(pages, '2026-08-28T01:02:03.000Z');
  pages[0].issues[0].status = 'fixed';
  assert.equal(checkpoint.id, 'backup-20260828010203');
  assert.equal(checkpoint.pages[0].issues[0].status, 'open');
});

test('refuses to apply changes without a backup', () => {
  const plan = createPlan(PAGES, ['home-link']);
  assert.throws(() => applyPlan(PAGES, plan, null), /backup_required/);
});

test('applies only planned issues without mutating source', () => {
  const plan = createPlan(PAGES, ['home-link', 'home-hero']);
  const checkpoint = createCheckpoint(PAGES, '2026-08-28T01:02:03.000Z');
  const result = applyPlan(PAGES, plan, checkpoint);
  assert.equal(auditSummary(result.pages).fixed, 2);
  assert.equal(auditSummary(PAGES).fixed, 0);
  assert.equal(result.report.applied, 2);
});

test('rollback restores the checkpoint state', () => {
  const checkpoint = createCheckpoint(PAGES, '2026-08-28T01:02:03.000Z');
  const changed = applyPlan(PAGES, createPlan(PAGES, ['delivery-link']), checkpoint).pages;
  assert.equal(auditSummary(changed).fixed, 1);
  assert.deepEqual(rollback(checkpoint), PAGES);
});
