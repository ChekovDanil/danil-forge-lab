import { packageModel } from './src/document.js';

const form = document.querySelector('#config');
const output = document.querySelector('#document');
const status = document.querySelector('#status');
const toast = document.querySelector('#toast');
let type = 'offer';
let model;

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const rubles = (value) => new Intl.NumberFormat('ru-RU',{style:'currency',currency:'RUB',maximumFractionDigits:2}).format(value);
const date = (value) => new Intl.DateTimeFormat('ru-RU',{dateStyle:'long'}).format(new Date(`${value}T00:00:00`));

function formModel() {
  const data = Object.fromEntries(new FormData(form));
  return packageModel({ ...data, prefix:'DF' });
}

function titleFor() {
  return ({ offer:'Коммерческое предложение', invoice:'Счёт на оплату', act:'Акт выполненных работ' })[type];
}

function render() {
  model = formModel();
  const payment = type === 'offer' ? 'Предложение действительно 10 календарных дней.' : type === 'invoice' ? 'Оплата по согласованным условиям заказа.' : 'Работы переданы в объёме, указанном ниже.';
  output.innerHTML = `<header><div class="doc-mark">DF</div><div><small>${escapeHtml(model.number)}</small><h2>${titleFor()}</h2></div><time>${date(model.issuedAt)}</time></header>
    <section class="parties"><div><small>ИСПОЛНИТЕЛЬ</small><b>Danil Forge</b><span>Цифровые продукты и автоматизация</span></div><div><small>ЗАКАЗЧИК</small><b>${escapeHtml(model.customer)}</b><span>Демонстрационные реквизиты</span></div></section>
    <section class="subject"><small>ПРОЕКТ</small><h3>${escapeHtml(model.project)}</h3><p>${escapeHtml(model.description)}</p></section>
    <table><thead><tr><th>Результат</th><th>Количество</th><th>Стоимость</th></tr></thead><tbody><tr><td>${escapeHtml(model.project)}</td><td>1 пакет</td><td>${rubles(model.subtotal)}</td></tr></tbody></table>
    <section class="totals"><div><span>Сумма</span><b>${rubles(model.subtotal)}</b></div><div><span>${model.rate ? `НДС ${model.rate}%` : 'НДС'}</span><b>${model.rate ? rubles(model.vat) : 'не облагается'}</b></div><div class="grand"><span>Итого</span><b>${rubles(model.total)}</b></div></section>
    <footer><p>${payment}</p><div><span>Подпись исполнителя</span><i></i></div></footer>`;
}

function notify(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => toast.classList.remove('show'), 1800);
}

function download(name, content, mime) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([content],{type:mime}));
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

form.addEventListener('input', render);
form.addEventListener('submit', (event) => { event.preventDefault(); render(); status.textContent = 'Пакет обновлён'; notify('Три документа синхронизированы'); });
form.addEventListener('reset', () => setTimeout(() => { render(); status.textContent = 'Сброшено'; }, 0));
document.querySelectorAll('[data-doc]').forEach((button) => button.addEventListener('click', () => { type = button.dataset.doc; document.querySelectorAll('[data-doc]').forEach((item) => item.classList.toggle('active',item === button)); render(); }));
document.querySelector('#downloadJson').addEventListener('click', () => { download(`${model.number}.json`,JSON.stringify({type,document:model},null,2),'application/json'); notify('Манифест готов'); });
document.querySelector('#downloadHtml').addEventListener('click', () => { const html = `<!doctype html><meta charset="utf-8"><title>${titleFor()}</title><style>body{font:16px Arial;max-width:820px;margin:48px auto;color:#17191c}small{color:#667085}table{width:100%;border-collapse:collapse;margin:28px 0}th,td{padding:12px;border-bottom:1px solid #ddd;text-align:left}.totals{margin-left:auto;max-width:320px}.totals div{display:flex;justify-content:space-between;padding:8px 0}.grand{font-size:20px;font-weight:700}</style>${output.innerHTML}`; download(`${model.number}-${type}.html`,html,'text/html'); notify('Автономный документ сохранён'); });
document.querySelector('#print').addEventListener('click', () => window.print());

render();
