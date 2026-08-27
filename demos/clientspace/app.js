import { approvalSummary, canPublish, canRequestChanges, deadlineState, financeSummary, projectProgress, sortActivity, updateApproval } from './src/project.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = (value) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const demoNow = new Date('2026-08-27T11:00:00+07:00');

// Полностью вымышленный набор для интерактивного портфолио.
// Здесь нет клиентских файлов, платежей, сотрудников или истории реального проекта.

const stages = [
  { title: 'Исследование', status: 'done', date: '12–16 августа', weight: 20, progress: 100 },
  { title: 'Структура и сценарии', status: 'done', date: '17–21 августа', weight: 25, progress: 100 },
  { title: 'Интерактивный прототип', status: 'active', date: '22–29 августа', weight: 30, progress: 90 },
  { title: 'Разработка первой версии', status: 'planned', date: '30 августа – 12 сентября', weight: 25, progress: 0 },
];

let approvals = [
  { id: 'demo-a1', title: 'Прототип личного кабинета', status: 'pending', fileUrl: '/demo-files/prototype-v3.fig', fileType: 'FIG', version: 3, dueAt: '2026-08-27T18:00:00+07:00', estimate: '7 минут', impact: 'Открывает этап разработки', note: '', changes: 'Уточнили навигацию, статусы заказов и состав главного экрана.' },
  { id: 'demo-a2', title: 'Состав первого релиза', status: 'pending', fileUrl: '/demo-files/scope-v2.pdf', fileType: 'PDF', version: 2, dueAt: '2026-08-26T18:00:00+07:00', estimate: '4 минуты', impact: 'Фиксирует бюджет и срок', note: '', changes: 'Разделили обязательные функции и задачи следующей очереди.' },
];

let activity = [
  { id: '1', at: '2026-08-27T10:42:00+07:00', actor: 'Команда', text: 'Загрузила прототип личного кабинета · версия 3', kind: 'event' },
  { id: '2', at: '2026-08-26T08:20:00+07:00', actor: 'Вы', text: 'Согласовали карту сценариев · версия 2', kind: 'decision' },
  { id: '3', at: '2026-08-25T13:10:00+07:00', actor: 'Команда', text: 'Ответила на вопросы по структуре каталога', kind: 'event' },
];

const staticFiles = [
  { id: 'demo-f2', title: 'Карта сценариев', fileType: 'PDF', version: 2, author: 'Демо-команда', date: '25 августа', size: '2,4 МБ', status: 'approved' },
  { id: 'demo-f3', title: 'Структура каталога', fileType: 'XLS', version: 1, author: 'Демо-команда', date: '23 августа', size: '860 КБ', status: 'working' },
];

const invoices = [
  { id: '01', title: 'Исследование и структура', amount: 65000, status: 'paid', date: '14 августа' },
  { id: '02', title: 'Прототип и дизайн', amount: 85000, status: 'due', date: 'до 30 августа' },
  { id: '03', title: 'Разработка первой версии', amount: 170000, status: 'draft', date: 'после согласования' },
];

let current = 'demo-a1';
let toastTimer;

function toast(text) {
  clearTimeout(toastTimer);
  $('toast').textContent = text;
  $('toast').classList.add('show');
  toastTimer = window.setTimeout(() => $('toast').classList.remove('show'), 2500);
}

function queueItems() {
  return approvals.filter((item) => item.status !== 'approved');
}

function deadlineCopy(item) {
  const state = deadlineState(item.dueAt, demoNow);
  if (state.state === 'overdue') return { className: 'overdue', text: `Просрочено · ${state.label}` };
  if (state.state === 'soon') return { className: 'soon', text: `Сегодня · ${state.label}` };
  return { className: '', text: state.label };
}

function renderApprovals() {
  const queue = queueItems();
  const summary = approvalSummary(approvals, demoNow);
  $('approvalHeading').textContent = queue.length === 0 ? 'Всё согласовано' : `${queue.length} ${queue.length === 1 ? 'решение' : 'решения'} · ${summary.overdue ? `${summary.overdue} просрочено` : 'сроки видны'}`;
  $('navBadge').textContent = String(queue.length);
  $('navBadge').classList.toggle('hidden', queue.length === 0);
  if (!queue.length) {
    $('approvals').innerHTML = '<div class="all-approved"><span>✓</span><div><h3>Все решения приняты</h3><p>Команда получила подтверждение и продолжает разработку первой версии.</p></div></div>';
    return;
  }
  $('approvals').innerHTML = queue.map((item) => {
    const deadline = deadlineCopy(item);
    const waiting = item.status === 'changes_requested';
    return `<button class="approval-card ${waiting ? 'changes' : ''}" data-approval="${esc(item.id)}" ${waiting ? 'disabled' : ''}>
      <span class="file-type">${esc(item.fileType)}</span>
      <header><span>${waiting ? 'Команда дорабатывает' : 'Нужно проверить'}</span><em class="${deadline.className}">${esc(deadline.text)}</em></header>
      <h3>${esc(item.title)} · v${item.version}</h3>
      <footer><span>${esc(item.estimate)} · ${esc(item.impact)}</span><b>${waiting ? 'Комментарий передан' : 'Открыть файл →'}</b></footer>
    </button>`;
  }).join('');
  document.querySelectorAll('[data-approval]:not([disabled])').forEach((button) => { button.onclick = () => openApproval(button.dataset.approval); });
}

function renderFiles() {
  const approvalFiles = approvals.map((item) => ({
    id: item.id,
    title: item.title,
    fileType: item.fileType,
    version: item.version,
    author: 'Демо-команда',
    date: item.version > 3 ? 'только что' : 'сегодня, 10:42',
    size: item.fileType === 'FIG' ? '18,6 МБ' : '1,8 МБ',
    status: item.status,
  }));
  const files = [...approvalFiles, ...staticFiles];
  $('fileCount').textContent = `${files.length} файла`;
  $('fileList').innerHTML = files.map((file) => {
    const label = file.status === 'approved' ? 'Согласовано' : file.status === 'changes_requested' ? 'Доработка' : file.status === 'pending' ? 'На согласовании' : 'Рабочий файл';
    const canOpen = approvals.some((item) => item.id === file.id && item.status === 'pending');
    return `<article class="file-card"><span>${esc(file.fileType)}</span><div><b>${esc(file.title)}</b><small>${esc(file.author)} · ${esc(file.date)} · ${esc(file.size)}</small></div><div class="version">Версия ${file.version}</div><em class="file-status ${file.status === 'pending' ? 'pending' : ''}">${label}</em>${canOpen ? `<button data-file="${esc(file.id)}">Открыть и проверить</button>` : '<button data-download>Скачать</button>'}</article>`;
  }).join('');
  document.querySelectorAll('[data-file]').forEach((button) => { button.onclick = () => openApproval(button.dataset.file); });
  document.querySelectorAll('[data-download]').forEach((button) => { button.onclick = () => toast('Демо-файл подготовлен к скачиванию'); });
}

function render() {
  const progress = projectProgress(stages);
  const finance = financeSummary(invoices);
  $('progress').textContent = progress + '%';
  $('miniProgress').textContent = progress + '%';
  $('paid').textContent = money(finance.paid);
  $('due').textContent = money(finance.due);
  $('total').textContent = money(finance.total);
  $('stages').innerHTML = stages.map((stage, index) => `<article class="${esc(stage.status)}"><span>${stage.status === 'done' ? '✓' : index + 1}</span><div><b>${esc(stage.title)}</b><small>${esc(stage.date)}</small></div><div class="stage-progress"><i style="width:${stage.progress}%"></i></div><em>${stage.status === 'done' ? 'Готово' : stage.status === 'active' ? 'Сейчас' : 'Далее'}</em></article>`).join('');
  $('activity').innerHTML = sortActivity(activity).map((item) => `<article><span>${esc(item.actor.slice(0, 1))}</span><div><b>${esc(item.actor)}</b><p>${esc(item.text)}</p>${item.kind === 'decision' ? '<small class="decision-chip">Решение сохранено</small>' : ''}</div><time>${new Date(item.at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</time></article>`).join('');
  $('invoices').innerHTML = invoices.map((item) => `<article class="invoice-card"><span>${esc(item.id)}</span><div><b>${esc(item.title)}</b><small>${esc(item.date)}</small></div><strong>${money(item.amount)}</strong><em class="${esc(item.status)}">${item.status === 'paid' ? 'Оплачено' : item.status === 'due' ? 'К оплате' : 'Черновик'}</em><button data-invoice>${item.status === 'due' ? 'Открыть счёт' : 'Документ'}</button></article>`).join('');
  document.querySelectorAll('[data-invoice]').forEach((button) => { button.onclick = () => toast('Документ открыт в демо-режиме'); });
  renderApprovals();
  renderFiles();
}

function openApproval(id) {
  const item = approvals.find((approval) => approval.id === id);
  if (!item || item.status !== 'pending') return;
  current = id;
  $('approvalTitle').textContent = item.title;
  $('approvalMeta').textContent = `${item.fileType} · версия ${item.version} · ${deadlineCopy(item).text}`;
  $('previewVersion').textContent = `v${item.version}`;
  $('approvalChanges').textContent = item.changes;
  $('comment').value = item.note;
  $('approval').showModal();
}

function addActivity(actor, text, kind = 'event') {
  activity.unshift({ id: crypto.randomUUID(), at: new Date().toISOString(), actor, text, kind });
}

function teamResubmit(id) {
  const item = approvals.find((approval) => approval.id === id);
  if (!item || item.status !== 'changes_requested') return;
  approvals = updateApproval(approvals, id, 'pending', item.note).map((approval) => approval.id === id ? { ...approval, version: approval.version + 1, dueAt: '2026-08-28T16:00:00+07:00', changes: `Учли комментарий клиента: ${approval.note}` } : approval);
  const updated = approvals.find((approval) => approval.id === id);
  addActivity('Команда', `Отправила новую версию: ${updated.title} · v${updated.version}`);
  render();
  toast('Команда отправила обновлённую версию');
}

$('approve').onclick = (event) => {
  event.preventDefault();
  const item = approvals.find((approval) => approval.id === current);
  if (!item || !canPublish(item)) return;
  const note = $('comment').value.trim();
  approvals = updateApproval(approvals, current, 'approved', note);
  addActivity('Вы', `Согласовали ${item.title} · v${item.version}${note ? ` · ${note}` : ''}`, 'decision');
  $('approval').close();
  render();
  toast('Решение и версия сохранены');
};

$('request').onclick = (event) => {
  event.preventDefault();
  const note = $('comment').value.trim();
  if (!canRequestChanges(note)) {
    toast('Опишите правки хотя бы одним предложением');
    $('comment').focus();
    return;
  }
  const item = approvals.find((approval) => approval.id === current);
  approvals = updateApproval(approvals, current, 'changes_requested', note);
  addActivity('Вы', `Запросили правки: ${item.title} · v${item.version} · ${note}`, 'decision');
  $('approval').close();
  render();
  toast('Комментарий передан команде');
  const id = current;
  window.setTimeout(() => teamResubmit(id), 1500);
};

document.querySelectorAll('.sidebar nav [data-view]').forEach((button) => {
  button.onclick = () => {
    document.querySelectorAll('.sidebar nav [data-view]').forEach((item) => { item.classList.remove('active'); item.setAttribute('aria-pressed', 'false'); });
    button.classList.add('active');
    button.setAttribute('aria-pressed', 'true');
    ['overview', 'files', 'finance'].forEach((id) => $(id).classList.toggle('hidden', id !== button.dataset.view));
    window.scrollTo({ top: 0, behavior: 'auto' });
  };
});

$('meetingButton').onclick = () => toast('Встреча добавлена в календарь');
render();
