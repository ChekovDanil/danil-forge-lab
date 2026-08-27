import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyImport, attentionQueue, bulkSetStatus, filterProducts, normalizeSku,
  previewImport, setProductStatus, stockDeficit, summarize, undoImport, validateProduct
} from '../src/inventory.js';

const products = [
  { sku: 'A-1', name: 'Лампа', category: 'Свет', stock: 2, minimum: 5, price: 1000, status: 'active' },
  { sku: 'B-2', name: 'Стол', category: 'Мебель', stock: 5, minimum: 2, price: 9000, status: 'draft' },
  { sku: 'C-3', name: 'Плед', category: 'Текстиль', stock: 8, minimum: 3, price: 2000, status: 'archived' }
];

test('считает рабочую сводку без архивных остатков', () => {
  assert.deepEqual(summarize(products), { total: 3, active: 1, units: 7, value: 47000, attention: 1, deficit: 3 });
});
test('фильтрует поиск, внимание и архив', () => {
  assert.equal(filterProducts(products, { query: 'мебель' })[0].sku, 'B-2');
  assert.equal(filterProducts(products, { status: 'attention' })[0].sku, 'A-1');
  assert.equal(filterProducts(products, { status: 'archived' })[0].sku, 'C-3');
});
test('очередь дефицита сортируется по величине', () => {
  const queue = attentionQueue([...products, { ...products[1], sku: 'D-4', stock: 0, minimum: 7, status: 'active' }]);
  assert.deepEqual(queue.map((item) => item.deficit), [7, 3]);
  assert.equal(stockDeficit(products[1]), 0);
});
test('нормализует SKU и находит дубликат без учёта регистра', () => {
  assert.equal(normalizeSku(' a-1 '), 'A-1');
  assert.match(validateProduct({ ...products[0], sku: ' a-1 ' }, products).join(' '), /существует/);
});
test('предпросмотр показывает до и после и не меняет каталог', () => {
  const rows = [{ sku: 'a-1', name: 'Лампа', category: 'Свет', stock: 8, minimum: 5, price: 1100, status: 'active' }];
  const result = previewImport(products, rows)[0];
  assert.equal(result.action, 'update');
  assert.deepEqual(result.before, { stock: 2, price: 1000, status: 'active' });
  assert.equal(result.after.stock, 8);
  assert.equal(products[0].stock, 2);
});
test('предпросмотр ловит полную строку и дубликаты', () => {
  const rows = [
    { sku: '', name: '', category: '', stock: -1, minimum: 1, price: 10, status: 'active' },
    { sku: 'D-4', name: 'Полка', category: 'Мебель', stock: 1, minimum: 1, price: 500, status: 'draft' },
    { sku: 'd-4', name: 'Полка', category: 'Мебель', stock: 2, minimum: 1, price: 500, status: 'draft' }
  ];
  const result = previewImport(products, rows);
  assert.ok(result[0].errors.length >= 4);
  assert.match(result[2].errors.join(' '), /Дубликат/);
});
test('применяет корректные строки и отменяет импорт', () => {
  const rows = [
    { sku: 'A-1', name: 'Лампа', category: 'Свет', stock: 9, minimum: 5, price: 1000, status: 'active' },
    { sku: 'D-4', name: 'Полка', category: 'Мебель', stock: 1, minimum: 2, price: 500, status: 'draft' }
  ];
  const result = applyImport(products, rows);
  assert.equal(result.applied, 2);
  assert.equal(result.products.find((item) => item.sku === 'A-1').stock, 9);
  assert.equal(result.products.length, 4);
  assert.deepEqual(undoImport(result.products, result.journal), products);
});
test('поддерживает публикацию, архив и восстановление', () => {
  const published = setProductStatus(products, 'B-2', 'active');
  const archived = bulkSetStatus(published, ['A-1'], 'archived');
  const restored = setProductStatus(archived, 'A-1', 'active');
  assert.equal(published[1].status, 'active');
  assert.equal(archived[0].status, 'archived');
  assert.equal(restored[0].status, 'active');
  assert.throws(() => setProductStatus(products, 'A-1', 'deleted'));
});
