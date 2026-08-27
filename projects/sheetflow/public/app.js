import { fieldLabels, formatMoney, reconcileTables, requiredFields, resultsToCsv, validateMapping } from '../src/sheetflow.js';

const leftRows = [
  { id: 'ORD-1041', client: 'Студия Маяк', email: 'hello@mayak.test', amount: '12 500 ₽' },
  { id: 'ORD-1042', client: 'Кофейня Контур', email: 'team@kontur.test', amount: '9 800 ₽' },
  { id: 'ORD-1043', client: 'Бюро Север', email: 'office@sever.test', amount: '7 400 ₽' },
  { id: 'ORD-1044', client: 'Маркет Линия', email: 'order@linia.test', amount: '18 900 ₽' },
  { id: 'ORD-1045', client: 'Отель Порт', email: 'booking@port.test', amount: '24 000 ₽' }
];

const rightRows = [
  { 'Номер заказа': 'ORD-1041', 'Почта клиента': 'HELLO@MAYAK.TEST', 'Оплачено': '12 500,00', 'Дата платежа': '27.08.2026' },
  { 'Номер заказа': 'ORD-1042', 'Почта клиента': 'team@kontur.test', 'Оплачено': '8 900,00', 'Дата платежа': '27.08.2026' },
  { 'Номер заказа': 'ORD-1043', 'Почта клиента': 'finance@sever.test', 'Оплачено': '7 400,00', 'Дата платежа': '27.08.2026' },
  { 'Номер заказа': 'ORD-1044', 'Почта клиента': 'order@linia.test', 'Оплачено': '18 900,00', 'Дата платежа': '28.08.2026' },
  { 'Номер заказа': 'ORD-1099', 'Почта клиента': 'extra@demo.test', 'Оплачено': '1 200,00', 'Дата платежа': '28.08.2026' }
];

const statusLabels = { matched: 'Совпало', amount: 'Сумма', email: 'Email', multiple: 'Два отличия', missing: 'Нет в B', unexpected: 'Нет в A' };
const mapping = { id: 'Номер заказа', email: 'Почта клиента', amount: 'Оплачено' };
let result = null;
let filter = 'all';
let toastTimer;
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);

function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').classList.add('visible');
  toastTimer = setTimeout(() => $('toast').classList.remove('visible'), 2200);
}

function renderPreviews() {
  $('leftPreview').innerHTML = leftRows.slice(0, 3).map((row) => `<tr><td>${row.id}</td><td>${row.client}</td><td>${row.amount}</td></tr>`).join('');
  $('rightPreview').innerHTML = rightRows.slice(0, 3).map((row) => `<tr><td>${row['Номер заказа']}</td><td>${row['Почта клиента']}</td><td>${row['Оплачено']}</td></tr>`).join('');
}

function renderMapping() {
  const headers = Object.keys(rightRows[0]);
  $('mappingGrid').innerHTML = requiredFields.map((field) => `<label><span>${fieldLabels[field]}</span><small>Таблица A → Таблица B</small><select data-field="${field}" aria-label="Колонка для поля ${fieldLabels[field]}">${headers.map((header) => `<option value="${escapeHtml(header)}" ${mapping[field] === header ? 'selected' : ''}>${escapeHtml(header)}</option>`).join('')}</select></label>`).join('');
  document.querySelectorAll('[data-field]').forEach((select) => select.addEventListener('change', () => { mapping[select.dataset.field] = select.value; updateMapping(); }));
  updateMapping();
}

function updateMapping() {
  const check = validateMapping(Object.keys(rightRows[0]), mapping);
  const ready = requiredFields.filter((field) => mapping[field]).length;
  $('mappingState').textContent = `${ready} из 3`;
  $('mappingState').classList.toggle('invalid', !check.valid);
  $('mappingHint').textContent = check.valid ? 'Все ключевые поля готовы к сверке.' : check.duplicates.length ? 'Каждую колонку можно использовать только один раз.' : 'Сопоставьте все ключевые поля.';
  $('reconcileButton').disabled = !check.valid;
}

function rowsForView() {
  if (!result) return [];
  if (filter === 'issues') return result.rows.filter((row) => row.status !== 'matched');
  if (filter === 'matched') return result.rows.filter((row) => row.status === 'matched');
  return result.rows;
}

function renderResults() {
  if (!result) return;
  $('metricTotal').textContent = result.summary.total;
  $('metricMatched').textContent = result.summary.matched;
  $('metricIssues').textContent = result.summary.issues;
  $('metricDelta').textContent = formatMoney(result.summary.delta);
  const rows = rowsForView();
  $('visibleCount').textContent = `${rows.length} из ${result.rows.length} строк`;
  $('resultRows').innerHTML = rows.map((row) => `<tr class="${row.status === 'matched' ? 'is-matched' : 'has-issue'}"><td><b>${escapeHtml(row.id)}</b><small>${escapeHtml(row.client)}</small></td><td><span>${escapeHtml(row.leftEmail || '—')}</span>${row.rightEmail && row.rightEmail !== row.leftEmail ? `<small>${escapeHtml(row.rightEmail)}</small>` : ''}</td><td>${formatMoney(row.leftAmount)}</td><td>${formatMoney(row.rightAmount)}</td><td><span class="status ${row.status}">${statusLabels[row.status]}</span><small>${escapeHtml(row.detail)}</small></td></tr>`).join('');
  $('resultEmpty').hidden = true;
  $('resultTable').hidden = false;
  $('exportButton').disabled = false;
}

function runReconcile() {
  result = reconcileTables(leftRows, rightRows, mapping);
  filter = 'all';
  document.querySelectorAll('[data-filter]').forEach((button) => { const active = button.dataset.filter === filter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
  renderResults();
  $('results').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  toast(`Сверка завершена: ${result.summary.issues} расхождения`);
}

function exportCsv() {
  const csv = `\uFEFF${resultsToCsv(result.rows)}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'sheetflow-reconciliation.csv' });
  link.click();
  URL.revokeObjectURL(url);
  toast('CSV подготовлен локально');
}

function reset() {
  Object.assign(mapping, { id: 'Номер заказа', email: 'Почта клиента', amount: 'Оплачено' });
  result = null;
  filter = 'all';
  renderMapping();
  $('resultEmpty').hidden = false;
  $('resultTable').hidden = true;
  $('exportButton').disabled = true;
  ['metricTotal','metricMatched','metricIssues','metricDelta'].forEach((id) => $(id).textContent = '—');
  $('visibleCount').textContent = 'Сверка ещё не запущена';
  toast('Демо сброшено');
}

$('reconcileButton').addEventListener('click', runReconcile);
$('exportButton').addEventListener('click', exportCsv);
$('resetButton').addEventListener('click', reset);
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => { filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach((item) => { const active = item === button; item.classList.toggle('active', active); item.setAttribute('aria-pressed', active); }); renderResults(); }));
renderPreviews();
renderMapping();
