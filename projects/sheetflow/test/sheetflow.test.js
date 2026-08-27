import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMoney, reconcileTables, resultsToCsv, validateMapping } from '../src/sheetflow.js';

const left = [
  { id: 'ORD-101', client: 'Маяк', email: 'hello@mayak.test', amount: '12 500,00' },
  { id: 'ORD-102', client: 'Контур', email: 'team@kontur.test', amount: '9 800' },
  { id: 'ORD-103', client: 'Север', email: 'office@sever.test', amount: '7 400' }
];
const right = [
  { 'Номер заказа': 'ORD-101', 'Почта клиента': 'HELLO@MAYAK.TEST', 'Оплачено': '12 500 ₽' },
  { 'Номер заказа': 'ORD-102', 'Почта клиента': 'team@kontur.test', 'Оплачено': '8 900 ₽' },
  { 'Номер заказа': 'ORD-999', 'Почта клиента': 'extra@example.test', 'Оплачено': '500 ₽' }
];
const mapping = { id: 'Номер заказа', email: 'Почта клиента', amount: 'Оплачено' };

test('денежные значения приводятся к копейкам', () => {
  assert.equal(parseMoney('12 500,50 ₽'), 1250050);
  assert.equal(parseMoney('ошибка'), null);
});

test('сопоставление не разрешает повторное использование колонки', () => {
  assert.equal(validateMapping(Object.keys(right[0]), { id: 'Номер заказа', email: 'Почта клиента', amount: 'Почта клиента' }).valid, false);
});

test('сверка находит совпадение, отличие суммы, пропуск и лишнюю строку', () => {
  const result = reconcileTables(left, right, mapping);
  assert.deepEqual(result.rows.map((row) => row.status), ['matched', 'amount', 'missing', 'unexpected']);
  assert.equal(result.summary.matched, 1);
  assert.equal(result.summary.issues, 3);
  assert.equal(result.summary.delta, 780000);
});

test('CSV содержит заголовок и нейтрализует формулы', () => {
  const csv = resultsToCsv([{ id: '=1+1', client: 'Тест', leftEmail: 'a@test', rightEmail: '', leftAmount: 1000, rightAmount: null, status: 'missing', detail: 'Нет строки' }]);
  assert.match(csv, /^ID;Клиент;/);
  assert.match(csv, /'=1\+1/);
});
