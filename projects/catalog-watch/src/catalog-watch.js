export const trackedFieldLabels = { title: 'Название', price: 'Цена', state: 'Наличие' };

const decode = (value) => String(value ?? '')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  .replace(/<[^>]*>/g, '').trim();

export function parseHtmlFixture(html) {
  const rows = [];
  const articlePattern = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = articlePattern.exec(String(html ?? '')))) {
    const attrs = match[1];
    const body = match[2];
    const attr = (name) => decode(attrs.match(new RegExp(`data-${name}=["']([^"']*)["']`, 'i'))?.[1]);
    const title = decode(body.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]);
    const sku = attr('sku');
    if (sku) rows.push({ sku, title, price: Number(attr('price')), state: attr('state'), revision: Number(attr('revision') || 0) });
  }
  return rows;
}

export function parseJsonFixture(json) {
  const value = typeof json === 'string' ? JSON.parse(json) : json;
  if (!Array.isArray(value)) throw new Error('JSON-снимок должен содержать массив записей');
  return value.map((row) => ({
    sku: String(row.sku ?? '').trim(),
    title: String(row.title ?? '').trim(),
    price: Number(row.price),
    state: String(row.state ?? '').trim(),
    revision: Number(row.revision ?? 0)
  })).filter((row) => row.sku);
}

export function deduplicate(rows) {
  const byKey = new Map();
  let duplicates = 0;
  for (const row of rows) {
    const current = byKey.get(row.sku);
    if (!current) { byKey.set(row.sku, row); continue; }
    duplicates += 1;
    if ((row.revision ?? 0) >= (current.revision ?? 0)) byKey.set(row.sku, row);
  }
  return { rows: [...byKey.values()], duplicates };
}

export function compareSnapshots(beforeRows, afterRows, fields = ['title', 'price', 'state']) {
  const selected = [...new Set(fields)].filter((field) => Object.hasOwn(trackedFieldLabels, field));
  if (!selected.length) throw new Error('Выберите хотя бы одно поле для сравнения');
  const before = deduplicate(beforeRows);
  const after = deduplicate(afterRows);
  const oldBySku = new Map(before.rows.map((row) => [row.sku, row]));
  const newBySku = new Map(after.rows.map((row) => [row.sku, row]));
  const keys = [...new Set([...oldBySku.keys(), ...newBySku.keys()])].sort();
  const rows = keys.map((sku) => {
    const oldRow = oldBySku.get(sku) ?? null;
    const newRow = newBySku.get(sku) ?? null;
    if (!oldRow) return { sku, status: 'new', oldRow, newRow, changes: [] };
    if (!newRow) return { sku, status: 'removed', oldRow, newRow, changes: [] };
    const changes = selected.filter((field) => oldRow[field] !== newRow[field]).map((field) => ({ field, before: oldRow[field], after: newRow[field] }));
    return { sku, status: changes.length ? 'changed' : 'unchanged', oldRow, newRow, changes };
  });
  const summary = ['new', 'changed', 'removed', 'unchanged'].reduce((acc, status) => ({ ...acc, [status]: rows.filter((row) => row.status === status).length }), { total: rows.length, duplicates: before.duplicates + after.duplicates });
  return { rows, summary, selectedFields: selected };
}

const csvCell = (value) => {
  const safe = /^[=+\-@]/.test(String(value ?? '')) ? `'${value}` : String(value ?? '');
  const escaped = safe.replace(/"/g, '""');
  return /[";,\n]/.test(escaped) ? `"${escaped}"` : escaped;
};

export function comparisonToCsv(rows) {
  const header = ['SKU', 'Статус', 'Название до', 'Название после', 'Цена до', 'Цена после', 'Наличие до', 'Наличие после', 'Изменённые поля'];
  const body = rows.map((row) => [row.sku, row.status, row.oldRow?.title ?? '', row.newRow?.title ?? '', row.oldRow?.price ?? '', row.newRow?.price ?? '', row.oldRow?.state ?? '', row.newRow?.state ?? '', row.changes.map((change) => trackedFieldLabels[change.field]).join(', ')]);
  return [header, ...body].map((record) => record.map(csvCell).join(';')).join('\r\n');
}
