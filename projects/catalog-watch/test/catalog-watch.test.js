import test from 'node:test';
import assert from 'node:assert/strict';
import { compareSnapshots, comparisonToCsv, deduplicate, parseHtmlFixture, parseJsonFixture } from '../src/catalog-watch.js';

const html = `<article data-sku="A-1" data-price="100" data-state="available" data-revision="1"><h3>Лампа</h3></article><article data-sku="A-2" data-price="200" data-state="limited"><h3>Стол</h3></article>`;
const json = JSON.stringify([
  { sku: 'A-1', title: 'Лампа', price: 120, state: 'available', revision: 1 },
  { sku: 'A-1', title: 'Лампа', price: 130, state: 'limited', revision: 2 },
  { sku: 'A-3', title: 'Кресло', price: 300, state: 'available', revision: 1 }
]);

test('HTML-fixture преобразуется в нормализованные записи', () => {
  assert.deepEqual(parseHtmlFixture(html)[0], { sku: 'A-1', title: 'Лампа', price: 100, state: 'available', revision: 1 });
});

test('JSON-fixture требует массив и удаляет строки без SKU', () => {
  assert.equal(parseJsonFixture('[{"sku":""},{"sku":"A"}]').length, 1);
  assert.throws(() => parseJsonFixture('{"sku":"A"}'), /массив/);
});

test('дедупликация оставляет запись с новой ревизией', () => {
  const result = deduplicate(parseJsonFixture(json));
  assert.equal(result.duplicates, 1);
  assert.equal(result.rows.find((row) => row.sku === 'A-1').price, 130);
});

test('сравнение находит изменённую, удалённую и новую записи', () => {
  const result = compareSnapshots(parseHtmlFixture(html), parseJsonFixture(json), ['price', 'state']);
  assert.deepEqual(result.rows.map((row) => row.status), ['changed', 'removed', 'new']);
  assert.equal(result.summary.duplicates, 1);
  assert.equal(result.rows[0].changes.length, 2);
});

test('набор отслеживаемых полей влияет на статус', () => {
  const result = compareSnapshots([{ sku: 'A', title: 'До', price: 10, state: 'ok' }], [{ sku: 'A', title: 'После', price: 10, state: 'ok' }], ['price']);
  assert.equal(result.rows[0].status, 'unchanged');
  assert.throws(() => compareSnapshots([], [], []), /хотя бы одно поле/);
});

test('CSV содержит статус и нейтрализует формулы', () => {
  const csv = comparisonToCsv([{ sku: '=1+1', status: 'new', oldRow: null, newRow: { title: 'Тест', price: 1, state: 'ok' }, changes: [] }]);
  assert.match(csv, /^SKU;Статус;/);
  assert.match(csv, /'=1\+1/);
});
