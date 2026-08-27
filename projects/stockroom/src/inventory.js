const STATUSES = new Set(['draft', 'active', 'archived']);

export function normalizeSku(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function validateProduct(product, products = [], originalSku = '') {
  const sku = normalizeSku(product.sku);
  const errors = [];
  if (String(product.name ?? '').trim().length < 2) errors.push('Укажите название');
  if (sku.length < 3) errors.push('Укажите артикул');
  if (String(product.category ?? '').trim().length < 2) errors.push('Укажите категорию');
  for (const field of ['stock', 'minimum', 'price']) {
    const value = Number(product[field]);
    if (!Number.isInteger(value) || value < 0) errors.push(`Некорректное поле: ${field}`);
  }
  if (!STATUSES.has(product.status ?? 'draft')) errors.push('Некорректный статус');
  const duplicate = products.some((item) => normalizeSku(item.sku) === sku && normalizeSku(item.sku) !== normalizeSku(originalSku));
  if (duplicate) errors.push('Такой артикул уже существует');
  return errors;
}

export function stockDeficit(product) {
  return Math.max(0, Number(product.minimum) - Number(product.stock));
}

export function summarize(products) {
  return products.reduce((result, product) => {
    result.total += 1;
    if (product.status === 'active') result.active += 1;
    if (product.status !== 'archived') {
      result.units += product.stock;
      result.value += product.stock * product.price;
    }
    if (product.status !== 'archived' && stockDeficit(product) > 0) {
      result.attention += 1;
      result.deficit += stockDeficit(product);
    }
    return result;
  }, { total: 0, active: 0, units: 0, value: 0, attention: 0, deficit: 0 });
}

export function filterProducts(products, { query = '', status = 'all' } = {}) {
  const needle = query.trim().toLowerCase();
  return products.filter((product) => {
    const matchesQuery = !needle || `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(needle);
    const matchesStatus = status === 'all'
      || (status === 'attention' && product.status !== 'archived' && stockDeficit(product) > 0)
      || product.status === status;
    return matchesQuery && matchesStatus;
  });
}

export function attentionQueue(products) {
  return products
    .filter((product) => product.status !== 'archived' && stockDeficit(product) > 0)
    .map((product) => ({ ...product, deficit: stockDeficit(product) }))
    .sort((a, b) => b.deficit - a.deficit || a.name.localeCompare(b.name, 'ru'));
}

export function previewImport(current, incoming) {
  const bySku = new Map(current.map((product) => [normalizeSku(product.sku), product]));
  const seen = new Set();
  return incoming.map((raw, index) => {
    const row = { ...raw, sku: normalizeSku(raw.sku), stock: Number(raw.stock) };
    const existing = bySku.get(row.sku);
    const errors = validateProduct({
      name: row.name,
      sku: row.sku,
      category: row.category,
      stock: row.stock,
      minimum: Number(row.minimum),
      price: Number(row.price),
      status: row.status ?? 'draft'
    }, current, existing?.sku ?? '');
    if (seen.has(row.sku)) errors.push('Дубликат в импорте');
    seen.add(row.sku);
    return {
      row: index + 1,
      sku: row.sku,
      action: existing ? 'update' : 'create',
      before: existing ? { stock: existing.stock, price: existing.price, status: existing.status } : null,
      after: { stock: row.stock, price: Number(row.price), status: row.status ?? 'draft' },
      product: row,
      errors
    };
  });
}

export function applyImport(current, incoming) {
  const preview = previewImport(current, incoming);
  const products = current.map((product) => ({ ...product }));
  const journal = [];
  for (const item of preview.filter((row) => row.errors.length === 0)) {
    const index = products.findIndex((product) => normalizeSku(product.sku) === item.sku);
    if (index >= 0) {
      journal.push({ sku: item.sku, action: 'updated', before: { ...products[index] } });
      products[index] = { ...products[index], ...item.product, sku: item.sku };
    } else {
      journal.push({ sku: item.sku, action: 'created' });
      products.push({ ...item.product, sku: item.sku });
    }
  }
  return { products, preview, journal, applied: journal.length, skipped: preview.length - journal.length };
}

export function undoImport(products, journal) {
  let restored = products.map((product) => ({ ...product }));
  for (const entry of [...journal].reverse()) {
    if (entry.action === 'created') restored = restored.filter((product) => normalizeSku(product.sku) !== entry.sku);
    else restored = restored.map((product) => normalizeSku(product.sku) === entry.sku ? { ...entry.before } : product);
  }
  return restored;
}

export function setProductStatus(products, sku, status) {
  if (!STATUSES.has(status)) throw new Error('Некорректный статус');
  return products.map((product) => normalizeSku(product.sku) === normalizeSku(sku) ? { ...product, status } : product);
}

export function bulkSetStatus(products, selectedSkus, status) {
  if (!STATUSES.has(status)) throw new Error('Некорректный статус');
  const selected = new Set(selectedSkus.map(normalizeSku));
  return products.map((product) => selected.has(normalizeSku(product.sku)) ? { ...product, status } : product);
}
