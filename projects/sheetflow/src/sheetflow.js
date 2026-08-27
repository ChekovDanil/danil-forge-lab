export const requiredFields = ['id', 'email', 'amount'];

export const fieldLabels = {
  id: 'Идентификатор',
  email: 'Email',
  amount: 'Сумма'
};

const csvSafe = (value) => {
  const text = String(value ?? '');
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
};

export function normalizeEmail(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null;
  const normalized = String(value ?? '')
    .replace(/\s|₽/g, '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  if (!normalized || !Number.isFinite(Number(normalized))) return null;
  return Math.round(Number(normalized) * 100);
}

export function formatMoney(cents) {
  if (!Number.isFinite(cents)) return '—';
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2 }).format(cents / 100);
}

export function validateMapping(headers, mapping) {
  const selected = requiredFields.map((field) => mapping[field]);
  const missing = requiredFields.filter((field) => !headers.includes(mapping[field]));
  const duplicates = selected.filter(Boolean).filter((header, index) => selected.indexOf(header) !== index);
  return { valid: missing.length === 0 && duplicates.length === 0, missing, duplicates: [...new Set(duplicates)] };
}

export function reconcileTables(leftRows, rightRows, mapping) {
  const rightHeaders = Object.keys(rightRows[0] ?? {});
  const validation = validateMapping(rightHeaders, mapping);
  if (!validation.valid) {
    throw new Error(validation.duplicates.length ? 'Колонки сопоставлены повторно' : 'Не все обязательные колонки сопоставлены');
  }

  const rightById = new Map();
  rightRows.forEach((row, index) => {
    const id = String(row[mapping.id] ?? '').trim();
    if (id) rightById.set(id, { row, sourceIndex: index });
  });

  const used = new Set();
  const rows = leftRows.map((left, index) => {
    const id = String(left.id ?? '').trim();
    const match = rightById.get(id);
    const leftAmount = parseMoney(left.amount);
    if (!match) {
      return { id, client: left.client, leftEmail: left.email, rightEmail: '', leftAmount, rightAmount: null, status: 'missing', detail: 'Нет строки во второй таблице', leftRow: index + 2, rightRow: null };
    }

    used.add(match.sourceIndex);
    const rightEmail = match.row[mapping.email];
    const rightAmount = parseMoney(match.row[mapping.amount]);
    const emailDiffers = normalizeEmail(left.email) !== normalizeEmail(rightEmail);
    const amountDiffers = leftAmount !== rightAmount;
    let status = 'matched';
    let detail = 'Данные совпадают';
    if (emailDiffers && amountDiffers) { status = 'multiple'; detail = 'Отличаются email и сумма'; }
    else if (emailDiffers) { status = 'email'; detail = 'Отличается email'; }
    else if (amountDiffers) { status = 'amount'; detail = 'Отличается сумма'; }
    return { id, client: left.client, leftEmail: left.email, rightEmail, leftAmount, rightAmount, status, detail, leftRow: index + 2, rightRow: match.sourceIndex + 2 };
  });

  rightRows.forEach((right, index) => {
    if (used.has(index)) return;
    const id = String(right[mapping.id] ?? '').trim();
    rows.push({ id, client: '—', leftEmail: '', rightEmail: right[mapping.email], leftAmount: null, rightAmount: parseMoney(right[mapping.amount]), status: 'unexpected', detail: 'Нет строки в первой таблице', leftRow: null, rightRow: index + 2 });
  });

  const matched = rows.filter((row) => row.status === 'matched').length;
  const issues = rows.length - matched;
  const leftTotal = leftRows.reduce((sum, row) => sum + (parseMoney(row.amount) ?? 0), 0);
  const rightTotal = rightRows.reduce((sum, row) => sum + (parseMoney(row[mapping.amount]) ?? 0), 0);
  return { rows, summary: { total: rows.length, matched, issues, leftTotal, rightTotal, delta: leftTotal - rightTotal } };
}

export function resultsToCsv(rows) {
  const header = ['ID', 'Клиент', 'Email в реестре', 'Email в отчёте', 'Сумма в реестре', 'Сумма в отчёте', 'Статус', 'Комментарий'];
  const records = rows.map((row) => [row.id, row.client, row.leftEmail, row.rightEmail, row.leftAmount == null ? '' : (row.leftAmount / 100).toFixed(2), row.rightAmount == null ? '' : (row.rightAmount / 100).toFixed(2), row.status, row.detail]);
  return [header, ...records].map((record) => record.map((value) => {
    const safe = csvSafe(value).replace(/"/g, '""');
    return /[";,\n]/.test(safe) ? `"${safe}"` : safe;
  }).join(';')).join('\r\n');
}
