import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCTS, addToCart, calculateCart, filterProducts, setCartQuantity } from '../src/store-core.js';

test('catalog uses unique synthetic identifiers', () => {
  assert.equal(PRODUCTS.length, 6);
  assert.equal(new Set(PRODUCTS.map((product) => product.id)).size, PRODUCTS.length);
});

test('filters by category without changing source order', () => {
  const result = filterProducts(PRODUCTS, { category: 'light' });
  assert.deepEqual(result.map((product) => product.id), ['arc-lamp', 'halo-light']);
  assert.equal(PRODUCTS[0].id, 'arc-lamp');
});

test('search is case-insensitive and includes descriptive fields', () => {
  assert.deepEqual(filterProducts(PRODUCTS, { query: 'ТИХИЙ' }).map((product) => product.id), ['still-clock']);
  assert.deepEqual(filterProducts(PRODUCTS, { query: 'рабочее место' }).map((product) => product.category), ['desk', 'desk']);
});

test('sorts by price in both directions', () => {
  const asc = filterProducts(PRODUCTS, { sort: 'price-asc' });
  const desc = filterProducts(PRODUCTS, { sort: 'price-desc' });
  assert.equal(asc[0].id, 'fold-tray');
  assert.equal(desc[0].id, 'arc-lamp');
});

test('adds a product immutably and caps quantity', () => {
  const original = { 'arc-lamp': 9 };
  const result = addToCart(original, 'arc-lamp');
  assert.deepEqual(result, { 'arc-lamp': 9 });
  assert.notEqual(result, original);
});

test('quantity zero removes the line', () => {
  assert.deepEqual(setCartQuantity({ 'arc-lamp': 2, 'fold-tray': 1 }, 'arc-lamp', 0), { 'fold-tray': 1 });
});

test('calculates paid shipping below the threshold', () => {
  const summary = calculateCart({ 'fold-tray': 2 });
  assert.equal(summary.count, 2);
  assert.equal(summary.subtotal, 6800);
  assert.equal(summary.shipping, 490);
  assert.equal(summary.total, 7290);
});

test('provides free shipping at the threshold and ignores unknown products', () => {
  const summary = calculateCart({ 'arc-lamp': 1, 'fold-tray': 1, unknown: 8 });
  assert.equal(summary.subtotal, 16300);
  assert.equal(summary.shipping, 0);
  assert.equal(summary.count, 2);
});
