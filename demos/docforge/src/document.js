export function money(value) {
  const amount = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : 0;
}

export function totals(amount, vatRate = 0) {
  const subtotal = money(amount);
  const rate = Math.max(0, Math.min(100, money(vatRate)));
  const vat = Math.round(subtotal * rate) / 100;
  return { subtotal, vat, total: Math.round((subtotal + vat) * 100) / 100, rate };
}

export function documentNumber(prefix, date, sequence = 1) {
  const safePrefix = String(prefix || 'DF').toUpperCase().replace(/[^A-ZА-Я0-9]/gi, '').slice(0, 6) || 'DF';
  const stamp = new Date(date || Date.now());
  const year = Number.isNaN(stamp.getTime()) ? new Date().getFullYear() : stamp.getFullYear();
  return `${safePrefix}-${year}-${String(Math.max(1, Number(sequence) || 1)).padStart(3, '0')}`;
}

export function packageModel(input = {}) {
  const issuedAt = input.issuedAt || new Date().toISOString().slice(0, 10);
  const result = totals(input.amount, input.vatRate);
  return {
    number: documentNumber(input.prefix, issuedAt, input.sequence),
    issuedAt,
    customer: String(input.customer || 'Новый клиент').trim(),
    project: String(input.project || 'Проект').trim(),
    description: String(input.description || '').trim(),
    ...result
  };
}
