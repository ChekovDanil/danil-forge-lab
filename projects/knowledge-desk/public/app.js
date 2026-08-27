const state = { snapshot: null, activeId: null };

const els = {
  metrics: document.querySelector('#metrics'), queue: document.querySelector('#queue'), queueCount: document.querySelector('#queueCount'),
  decisionState: document.querySelector('#decisionState'), decisionId: document.querySelector('#decisionId'), decisionBody: document.querySelector('#decisionBody'),
  evidenceList: document.querySelector('#evidenceList'), sourceCount: document.querySelector('#sourceCount'), form: document.querySelector('#questionForm'),
  input: document.querySelector('#questionInput'), reset: document.querySelector('#resetButton'), toast: document.querySelector('#toast')
};

const labels = {
  answer: ['Источник подтверждён', 'answer'],
  clarify: ['Нужно уточнение', 'clarify'],
  handoff: ['Передать человеку', 'handoff']
};

function escapeHtml(value = '') {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

async function api(path, options) {
  const response = await fetch(path, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'request_failed');
  return body;
}

function activeRecord() {
  const questions = state.snapshot?.questions ?? [];
  return questions.find((item) => item.id === state.activeId) ?? questions.at(-1);
}

function renderMetrics() {
  const stats = state.snapshot.stats;
  els.metrics.innerHTML = [
    ['Источники', stats.approvedSources], ['Ответы', stats.answer], ['Уточнения', stats.clarify], ['Передано', stats.handoff]
  ].map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('');
}

function renderQueue() {
  const questions = [...state.snapshot.questions].reverse();
  els.queueCount.textContent = questions.length;
  els.queue.innerHTML = questions.map((item) => {
    const [label, className] = labels[item.decision.type];
    return `<button class="queue-item ${item.id === activeRecord()?.id ? 'active' : ''}" data-id="${item.id}" type="button"><span><i class="${className}"></i>${label}</span><b>${escapeHtml(item.question)}</b><small>${item.id} · ${item.decision.citations.length} source</small></button>`;
  }).join('');
  els.queue.querySelectorAll('[data-id]').forEach((button) => button.addEventListener('click', () => { state.activeId = button.dataset.id; render(); }));
}

function citationMarkup(citation, index) {
  return `<article class="source-card"><header><span>${String(index + 1).padStart(2, '0')}</span><b>APPROVED · V${citation.version}</b></header><h3>${escapeHtml(citation.title)}</h3><p>${escapeHtml(citation.fragment?.text ?? '')}</p><footer><span>${escapeHtml(citation.sourceId)}</span><time>${escapeHtml(citation.effectiveAt)}</time></footer></article>`;
}

function renderDecision() {
  const record = activeRecord();
  if (!record) return;
  const decision = record.decision;
  const [label, className] = labels[decision.type];
  els.decisionState.textContent = label;
  els.decisionState.className = className;
  els.decisionId.textContent = `${record.id} · ${record.createdAt.slice(11, 16)}`;
  const meta = decision.type === 'answer'
    ? `<div class="decision-meta"><span>Основание</span><b>Утверждённая редакция</b><span>Действие</span><b>Можно отправить</b></div>`
    : decision.type === 'clarify'
      ? `<div class="decision-meta"><span>Пробел</span><b>${decision.reason === 'plan_required' ? 'Не указан тариф' : 'Нет подтверждённого раздела'}</b><span>Действие</span><b>Задать один вопрос</b></div>`
      : `<div class="decision-meta"><span>Очередь</span><b>${escapeHtml(decision.queue)}</b><span>Приоритет</span><b>${decision.urgency === 'high' ? 'Высокий' : 'Обычный'}</b></div>`;
  const packet = decision.packet ? `<section class="handoff-packet"><span>ПАКЕТ ПЕРЕДАЧИ</span><dl><div><dt>Пробел</dt><dd>${escapeHtml(decision.packet.gap)}</dd></div><div><dt>Следующий шаг</dt><dd>${escapeHtml(decision.packet.nextAction)}</dd></div></dl></section>` : '';
  els.decisionBody.innerHTML = `
    <div class="question-note"><span>ВОПРОС КЛИЕНТА</span><p>${escapeHtml(record.question)}</p></div>
    <section class="response-block"><header><span>ПРЕДЛОЖЕННЫЙ ОТВЕТ</span><i class="${className}">${label}</i></header><p>${escapeHtml(decision.answer)}</p></section>
    ${meta}${packet}
    <div class="feedback-row"><span>Решение оператора</span><button type="button" data-feedback="accepted">Принять</button><button type="button" data-feedback="corrected">Нужна правка</button></div>`;
  els.decisionBody.querySelectorAll('[data-feedback]').forEach((button) => button.addEventListener('click', () => sendFeedback(record.id, button.dataset.feedback)));
}

function renderEvidence() {
  const record = activeRecord();
  const citations = record?.decision.citations ?? [];
  els.sourceCount.textContent = citations.length;
  els.evidenceList.innerHTML = citations.length ? citations.map(citationMarkup).join('') : `<div class="empty-evidence"><span>0 SOURCES</span><p>Ответ остановлен: подходящего утверждённого источника нет.</p></div>`;
}

function render() { renderMetrics(); renderQueue(); renderDecision(); renderEvidence(); }

function notify(text) {
  els.toast.textContent = text;
  els.toast.classList.add('show');
  window.setTimeout(() => els.toast.classList.remove('show'), 2200);
}

async function refresh(preferredId) {
  state.snapshot = await api('/api/state');
  state.activeId = preferredId ?? state.snapshot.questions.at(-1)?.id ?? null;
  render();
}

async function submitQuestion(question) {
  const value = question.trim();
  if (value.length < 3) return notify('Введите вопрос подробнее');
  const record = await api('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question: value }) });
  els.input.value = '';
  await refresh(record.id);
  notify('Вопрос проверен по базе');
}

async function sendFeedback(questionId, value) {
  await api('/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ questionId, value }) });
  notify(value === 'accepted' ? 'Решение принято' : 'Правка отмечена');
  await refresh(questionId);
}

els.form.addEventListener('submit', (event) => { event.preventDefault(); submitQuestion(els.input.value).catch((error) => notify(error.message)); });
document.querySelectorAll('[data-question]').forEach((button) => button.addEventListener('click', () => submitQuestion(button.dataset.question).catch((error) => notify(error.message))));
els.reset.addEventListener('click', async () => { await api('/api/reset', { method: 'POST' }); await refresh(); notify('Демо восстановлено'); });

refresh().catch((error) => notify(error.message));
