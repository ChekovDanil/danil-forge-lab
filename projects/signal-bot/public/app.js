const servicesRoot = document.querySelector('#services');
const incidentsRoot = document.querySelector('#incidents');
const messagesRoot = document.querySelector('#messages');
const summary = document.querySelector('#summary');

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить действие');
  return data;
}

function renderServices(services) {
  servicesRoot.innerHTML = services.map((service) => `<article class="service ${service.status}"><div class="service-top"><h3>${service.name}</h3><small>${service.latencyMs} мс</small></div><span class="service-status"><i></i>${service.status === 'healthy' ? 'Отвечает' : service.status === 'degraded' ? 'Проверить' : 'Нет ответа'}</span><button data-mute="${service.id}">Не беспокоить 30 мин</button></article>`).join('');
}

function renderIncidents(incidents) {
  const active = incidents.filter((incident) => incident.state !== 'resolved');
  incidentsRoot.innerHTML = active.length ? active.map((incident) => `<article class="incident-card"><div class="incident-top"><span class="incident-id">${incident.id}</span><span class="severity ${incident.severity}">${incident.severity === 'critical' ? 'Критический' : 'Проверить'}</span></div><h3>${incident.serviceName}</h3><p>${incident.summary}</p><div class="incident-meta"><span>${incident.checks} проверк.</span><span>${incident.lastLatencyMs} мс</span><span>${incident.state === 'acknowledged' ? `Взял: ${incident.acknowledgedBy}` : 'Не подтверждён'}</span></div><div class="incident-actions"><button data-ack="${incident.id}" ${incident.state === 'acknowledged' ? 'disabled' : ''}>${incident.state === 'acknowledged' ? 'Принято' : 'Взять в работу'}</button></div></article>`).join('') : '<div class="empty">Все сервисы отвечают.<br>Новых решений не требуется.</div>';
}

function renderMessages(messages) {
  const visible = messages.filter((message) => message.delivery !== 'grouped').slice(0, 5);
  messagesRoot.innerHTML = visible.length ? visible.map((message) => `<div class="bubble ${message.delivery === 'digest' || message.delivery === 'muted' ? 'muted' : ''}">${message.text}<small>${message.delivery === 'digest' ? 'Утренняя сводка' : message.delivery === 'muted' ? 'Заглушено' : 'Отправить сразу'}</small></div>`).join('') : '<div class="bubble">Все 3 сервиса отвечают. Активных инцидентов нет.<small>/status</small></div>';
}

function render(state) {
  renderServices(state.services);
  renderIncidents(state.incidents);
  renderMessages(state.messages);
  summary.textContent = state.summary;
}

async function setScenario(name) {
  const state = await api('/api/scenario', { method: 'POST', body: JSON.stringify({ name }) });
  document.querySelectorAll('[data-scenario]').forEach((button) => button.classList.toggle('active', button.dataset.scenario === name));
  render(state);
}

document.addEventListener('click', async (event) => {
  const scenario = event.target.closest('[data-scenario]');
  const ack = event.target.closest('[data-ack]');
  const mute = event.target.closest('[data-mute]');
  try {
    if (scenario) return setScenario(scenario.dataset.scenario);
    if (ack) return render(await api(`/api/incidents/${encodeURIComponent(ack.dataset.ack)}/ack`, { method: 'POST', body: JSON.stringify({ by: 'Вы' }) }));
    if (mute) return render(await api(`/api/services/${encodeURIComponent(mute.dataset.mute)}/mute`, { method: 'POST', body: JSON.stringify({ minutes: 30 }) }));
  } catch (error) {
    summary.textContent = error.message;
  }
});

setScenario('critical').catch((error) => { summary.textContent = error.message; });
