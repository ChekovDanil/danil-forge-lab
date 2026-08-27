import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDelimiter, inspectCsv, issuesToCsv, normalizeAmount, normalizeDate, normalizePhone, parseCsv, processCsv, suggestMapping, toCsv } from '../src/reportkit.js';

test('определяет разделитель и читает кавычки', () => {
  const input = 'Дата;Клиент;Телефон;Сумма;Статус\n27.08.2026;"Студия; Мера";89130000000;12 500,50;new';
  assert.equal(detectDelimiter(input), ';');
  assert.equal(parseCsv(input)[1][1], 'Студия; Мера');
});
test('инспектирует заголовки и число строк', () => {
  assert.deepEqual(inspectCsv('a,b\n1,2\n3,4').headers, ['a', 'b']);
  assert.equal(inspectCsv('a,b\n1,2\n3,4').rowCount, 2);
});
test('автоматически сопоставляет русские и английские колонки', () => {
  const mapping = suggestMapping(['Дата', 'customer', 'Телефон', 'total', 'Этап']);
  assert.deepEqual(mapping, { date: 'Дата', client: 'customer', phone: 'Телефон', amount: 'total', status: 'Этап' });
});
test('нормализует основные типы', () => {
  assert.equal(normalizePhone('8 (000) 000-00-00'), '+7 000 000-00-00');
  assert.equal(normalizeAmount('12 500,50 ₽'), 12500.5);
  assert.equal(normalizeDate('7.8.2026'), '2026-08-07');
  assert.equal(normalizeDate('31.02.2026'), '');
});
test('обрабатывает файл с русскими заголовками', () => {
  const input = 'Дата;Клиент;Телефон;Сумма;Статус\n27.08.2026;Кофейня Шум;89130001842;5000;Новый\n31.02.2026;;123;abc;Новый';
  const result = processCsv(input);
  assert.deepEqual(result.summary, { total: 2, valid: 1, invalid: 1, amount: 5000 });
  assert.equal(result.issues.length, 4);
  assert.match(toCsv(result.rows), /Кофейня Шум/);
});
test('принимает ручное сопоставление нестандартных колонок', () => {
  const input = 'when;who;tel;sum;stage_name\n27.08.2026;Мера;89130001842;5000;new';
  const mapping = { date: 'when', client: 'who', phone: 'tel', amount: 'sum', status: 'stage_name' };
  assert.equal(processCsv(input, mapping).summary.valid, 1);
});
test('сообщает о несопоставленных столбцах', () => {
  const result = processCsv('client,amount\nA,10');
  assert.match(result.issues[0].message, /Не сопоставлены/);
});
test('нейтрализует формулы в обоих экспортных файлах', () => {
  const csv = toCsv([{ date: '2026-08-27', client: '=HYPERLINK("bad")', phone: '+7 000 000-00-00', amount: 10, status: '@cmd', valid: true }]);
  const issues = issuesToCsv([{ row: 2, field: 'client', value: '=BAD()', message: 'ошибка' }]);
  assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'@cmd/);
  assert.match(issues, /'=BAD/);
});
