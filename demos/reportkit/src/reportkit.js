export const requiredColumns = ['date', 'client', 'phone', 'amount', 'status'];

const aliases = {
  date: ['date', 'дата', 'created_at', 'created'],
  client: ['client', 'клиент', 'customer', 'company', 'компания'],
  phone: ['phone', 'телефон', 'mobile', 'номер'],
  amount: ['amount', 'сумма', 'total', 'revenue', 'выручка'],
  status: ['status', 'статус', 'stage', 'этап']
};

export function detectDelimiter(text) {
  const first = String(text).split(/\r?\n/, 1)[0] ?? '';
  return [';', ',', '\t'].map((delimiter) => ({ delimiter, count: first.split(delimiter).length - 1 })).sort((a, b) => b.count - a.count)[0].delimiter;
}

export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let index = 0; index < String(text).length; index += 1) {
    const char = text[index], next = text[index + 1];
    if (char === '"' && quoted && next === '"') { cell += '"'; index += 1; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (char === delimiter && !quoted) { row.push(cell.trim()); cell = ''; continue; }
    if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; continue;
    }
    cell += char;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function inspectCsv(text) {
  const delimiter = detectDelimiter(text);
  const matrix = parseCsv(text, delimiter);
  const headers = (matrix[0] ?? []).map((header) => header.trim()).filter(Boolean);
  return { delimiter, headers, rowCount: Math.max(0, matrix.length - 1), matrix };
}

export function suggestMapping(headers) {
  const lower = new Map(headers.map((header) => [header.toLowerCase().trim(), header]));
  return Object.fromEntries(requiredColumns.map((column) => [column, aliases[column].map((alias) => lower.get(alias)).find(Boolean) ?? '']));
}

export function normalizePhone(value) {
  const digits = String(value).replace(/\D/g, '');
  const normalized = digits.length === 11 && digits[0] === '8' ? `7${digits.slice(1)}` : digits;
  return normalized.length === 11 && normalized[0] === '7' ? `+7 ${normalized.slice(1, 4)} ${normalized.slice(4, 7)}-${normalized.slice(7, 9)}-${normalized.slice(9)}` : '';
}

export function normalizeAmount(value) {
  const cleaned = String(value).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
}

export function normalizeDate(value) {
  const match = String(value).trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!match) return '';
  const [, day, month, year] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return date.getUTCFullYear() === Number(year) && date.getUTCMonth() === Number(month) - 1 && date.getUTCDate() === Number(day) ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}` : '';
}

export function processCsv(text, mapping = null) {
  const inspected = inspectCsv(text);
  const { delimiter, headers, matrix } = inspected;
  if (!matrix.length) return { delimiter, headers: [], mapping: {}, rows: [], issues: [{ row: 1, field: 'file', message: 'Файл пуст' }], summary: { total: 0, valid: 0, invalid: 0, amount: 0 } };
  const resolved = { ...suggestMapping(headers), ...(mapping ?? {}) };
  const missing = requiredColumns.filter((column) => !resolved[column] || !headers.includes(resolved[column]));
  if (missing.length) return { delimiter, headers, mapping: resolved, rows: [], issues: [{ row: 1, field: 'headers', message: `Не сопоставлены: ${missing.join(', ')}` }], summary: { total: matrix.length - 1, valid: 0, invalid: matrix.length - 1, amount: 0 } };

  const indexes = Object.fromEntries(requiredColumns.map((column) => [column, headers.indexOf(resolved[column])]));
  const issues = [];
  const rows = matrix.slice(1).map((cells, rowIndex) => {
    const raw = Object.fromEntries(requiredColumns.map((column) => [column, cells[indexes[column]] ?? '']));
    const normalized = { date: normalizeDate(raw.date), client: raw.client.trim(), phone: normalizePhone(raw.phone), amount: normalizeAmount(raw.amount), status: raw.status.trim().toLowerCase() };
    if (!normalized.date) issues.push({ row: rowIndex + 2, field: 'date', value: raw.date, message: 'Неверная дата' });
    if (!normalized.client) issues.push({ row: rowIndex + 2, field: 'client', value: raw.client, message: 'Не указан клиент' });
    if (!normalized.phone) issues.push({ row: rowIndex + 2, field: 'phone', value: raw.phone, message: 'Неверный телефон' });
    if (normalized.amount === null) issues.push({ row: rowIndex + 2, field: 'amount', value: raw.amount, message: 'Неверная сумма' });
    return { ...normalized, sourceRow: rowIndex + 2, valid: !issues.some((issue) => issue.row === rowIndex + 2) };
  });
  const validRows = rows.filter((row) => row.valid);
  return { delimiter, headers, mapping: resolved, rows, issues, summary: { total: rows.length, valid: validRows.length, invalid: rows.length - validRows.length, amount: validRows.reduce((sum, row) => sum + row.amount, 0) } };
}

const neutralizeFormula = (value) => {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text.trimStart()) ? `'${text}` : text;
};
const escapeCsv = (value) => `"${neutralizeFormula(value).replaceAll('"', '""')}"`;

export function toCsv(rows) {
  return ['date,client,phone,amount,status', ...rows.filter((row) => row.valid).map((row) => [row.date, row.client, row.phone, row.amount.toFixed(2), row.status].map(escapeCsv).join(','))].join('\n');
}

export function issuesToCsv(issues) {
  return ['row,field,value,message', ...issues.map((issue) => [issue.row, issue.field, issue.value ?? '', issue.message].map(escapeCsv).join(','))].join('\n');
}
