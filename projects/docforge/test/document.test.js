import test from 'node:test';
import assert from 'node:assert/strict';
import { documentNumber, money, packageModel, totals } from '../src/document.js';

test('normalizes money safely', () => {
  assert.equal(money('1250,50'), 1250.5);
  assert.equal(money('-10'), 0);
  assert.equal(money('wrong'), 0);
});

test('calculates VAT and total', () => {
  assert.deepEqual(totals(10000, 20), { subtotal: 10000, vat: 2000, total: 12000, rate: 20 });
});

test('creates stable document number', () => {
  assert.equal(documentNumber('df', '2026-08-28', 7), 'DF-2026-007');
});

test('builds normalized package model', () => {
  const model = packageModel({ customer: ' Demo ', project: 'Site', amount: '8000', vatRate: 5, issuedAt: '2026-08-28' });
  assert.equal(model.customer, 'Demo');
  assert.equal(model.total, 8400);
});
