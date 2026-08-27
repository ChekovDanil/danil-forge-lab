import { RequestQueue, demoRequests } from './src/queue.js';

const queue = new RequestQueue(demoRequests);
const $ = (id) => document.getElementById(id);
const nodes = {
  list: $('requestList'), visible: $('visibleCount'), history: $('history'), newCount: $('newCount'), priorityCount: $('priorityCount'), approvedCount: $('approvedCount'),
  source: $('detailSource'), meta: $('detailMeta'), title: $('detailTitle'), client: $('detailClient'), budget: $('detailBudget'), deadline: $('detailDeadline'), score: $('detailScore'),
  brief: $('detailBrief'), proposal: $('detailProposal'), risk: $('detailRisk'), priority: $('priorityButton'), approve: $('approveButton'), escalate: $('escalateButton'), toast: $('toast')
};
let filter = 'all';
let selectedId = demoRequests[0].id;

const statusLabel = (status) => ({ new: 'Новая', approved: 'Принята', escalated: 'Нужна оценка', closed: 'Закрыта' }[status] ?? status);
const escapeHtml = (value) => { const span = document.createElement('span'); span.textContent = value ?? ''; return span.innerHTML; };

function showToast(message) {
  nodes.toast.textContent = message;
  nodes.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => nodes.toast.classList.remove('show'), 2300);
}

function renderList() {
  const items = queue.list(filter);
  if (!items.some((item) => item.id === selectedId) && items[0]) selectedId = items[0].id;
  nodes.visible.textContent = String(items.length).padStart(2, '0');
  nodes.list.innerHTML = items.length ? items.map((item) => `<button class="request-card ${item.id === selectedId ? 'active' : ''}" data-id="${item.id}" type="button"><div class="request-card-top"><span>${escapeHtml(item.source)}</span><time>${escapeHtml(item.age)}</time></div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.category)} · ${escapeHtml(item.budget)}</p><footer><span class="status ${item.status}">${statusLabel(item.status)}</span><b>${item.score}%</b></footer></button>`).join('') : '<div class="empty"><b>Здесь пока пусто</b><p>Выберите другой фильтр.</p></div>';
}

function renderDetail() {
  let item;
  try { item = queue.get(selectedId); } catch { return; }
  nodes.source.textContent = item.source;
  nodes.meta.textContent = `${item.category} · ${item.age} назад`;
  nodes.title.textContent = item.title;
  nodes.client.textContent = `Заказчик: ${item.client}`;
  nodes.budget.textContent = item.budget;
  nodes.deadline.textContent = item.deadline;
  nodes.score.textContent = `${item.score}%`;
  nodes.brief.textContent = item.brief;
  nodes.proposal.textContent = item.proposal;
  nodes.risk.textContent = item.risk;
  nodes.priority.textContent = item.priority === 'high' ? '★' : '☆';
  nodes.priority.classList.toggle('active', item.priority === 'high');
  nodes.approve.disabled = item.status === 'approved';
  nodes.approve.textContent = item.status === 'approved' ? 'Подтверждено' : 'Подтвердить';
  nodes.escalate.disabled = ['approved', 'escalated'].includes(item.status);
  nodes.escalate.textContent = item.status === 'escalated' ? 'Передано мне' : 'Нужна моя оценка';
}

function renderSummary() {
  const summary = queue.summary();
  nodes.newCount.textContent = summary.new;
  nodes.priorityCount.textContent = summary.priority;
  nodes.approvedCount.textContent = summary.approved;
}

function renderHistory() {
  nodes.history.innerHTML = queue.history().map((event) => `<li class="${event.type}"><i></i><div><b>${escapeHtml(event.title)}</b><span>${escapeHtml(event.at)}</span></div></li>`).join('');
}

function render() { renderSummary(); renderList(); renderDetail(); renderHistory(); }

document.querySelector('.filters').addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (!button) return;
  filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((entry) => entry.classList.toggle('active', entry === button));
  render();
});
nodes.list.addEventListener('click', (event) => { const card = event.target.closest('[data-id]'); if (!card) return; selectedId = card.dataset.id; render(); if (matchMedia('(max-width: 760px)').matches) document.querySelector('.request-detail').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
nodes.priority.addEventListener('click', () => { queue.togglePriority(selectedId); render(); showToast('Приоритет обновлён'); });
nodes.approve.addEventListener('click', () => { queue.approve(selectedId); render(); showToast('Заявка подтверждена'); });
nodes.escalate.addEventListener('click', () => { queue.escalate(selectedId); render(); showToast('Заявка поднята для ручной оценки'); });

render();
