const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
let state;
let currentStory = 'attack';
let auditFilter = 'all';

const stories = {
  attack: {
    number: '01', type: 'LOGIN PROTECTION', title: 'Три ошибки.<br>Вход закрыт.',
    text: 'Система считает неудачные попытки и временно блокирует вход. Recovery сбрасывает блокировку, а token работает только один раз.',
    controls: '<button data-action="lockout">Сымитировать 3 ошибки</button><button class="secondary" data-action="recovery">Восстановить доступ</button>',
    timeline: [['01','Неверный пароль'],['02','Неверный пароль'],['03','Блокировка'],['04','Recovery']]
  },
  invite: {
    number: '02', type: 'ONE-TIME INVITATION', title: 'Одна ссылка.<br>Один участник.',
    text: 'Owner создаёт приглашение с ролью. После принятия token удаляется, поэтому повторное использование получает отказ.',
    controls: '<label><span>Email</span><input id="inviteEmail" value="new.member@studio.local" type="email"></label><label><span>Роль</span><select id="inviteRole"><option value="viewer">Viewer</option><option value="editor">Editor</option></select></label><button data-action="invite">Создать и принять</button>',
    timeline: [['01','Token issued'],['02','Role attached'],['03','Token consumed'],['04','Replay denied']]
  },
  role: {
    number: '03', type: 'ROLE POLICY', title: 'Роль меняется.<br>Контроль остаётся.',
    text: 'Viewer можно повысить до editor и вернуть обратно. Последнего owner понизить нельзя — пространство не останется без управления.',
    controls: '<button data-action="promote">Viewer ↔ Editor</button><button class="secondary" data-action="last-owner">Понизить последнего owner</button>',
    timeline: [['viewer','content:read'],['editor','+ content:write'],['owner','+ users + audit'],['guard','LAST_OWNER']]
  },
  privacy: {
    number: '04', type: 'ACCOUNT PRIVACY', title: 'Одинаковый ответ.<br>Никакой подсказки.',
    text: 'Запрос восстановления для неизвестного email выглядит так же, как для существующего. Это не позволяет проверять аккаунты по ответу формы.',
    controls: '<button data-action="unknown-recovery">Проверить неизвестный email</button><button class="secondary" data-action="recovery">Проверить существующий</button>',
    timeline: [['request','Request accepted'],['response','Same shape'],['token','Stored as hash'],['audit','No raw token']]
  }
};

async function api(path, options) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'REQUEST_FAILED');
  return data;
}

function renderStory() {
  const story = stories[currentStory];
  $('storyNumber').textContent = story.number;
  $('storyType').textContent = story.type;
  $('storyTitle').innerHTML = story.title;
  $('storyText').textContent = story.text;
  $('storyControls').innerHTML = story.controls;
  $('timeline').innerHTML = story.timeline.map(([number, label]) => `<div><span>${escapeHtml(number)}</span><b>${escapeHtml(label)}</b></div>`).join('');
  document.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => run(button.dataset.action)));
}

function renderMembers() {
  $('memberList').innerHTML = state.users.map((user) => `<article class="member ${user.lockedUntil ? 'locked' : ''}"><div class="member-top"><span>${escapeHtml(user.email.slice(0,1).toUpperCase())}</span><div><b>${escapeHtml(user.email)}</b><small>${user.lockedUntil ? 'Вход временно заблокирован' : 'Доступ активен'}</small></div><em>${escapeHtml(user.role)}</em></div><div class="permissions">${user.permissions.map((permission) => `<i>${escapeHtml(permission)}</i>`).join('')}</div></article>`).join('');
}

function actionLabel(action) {
  return ({ 'user.register':'Регистрация', 'invitation.create':'Приглашение создано', 'invitation.accept':'Приглашение принято', 'user.login':'Попытка входа', 'recovery.request':'Recovery запрошен', 'recovery.consume':'Recovery использован', 'user.role_change':'Роль изменена' })[action] ?? action;
}

function renderAudit() {
  const visible = state.audit.filter((event) => auditFilter === 'all' || event.outcome === auditFilter);
  $('auditList').innerHTML = visible.slice(0, 14).map((event) => `<article><span class="audit-dot ${event.outcome}"></span><div><b>${escapeHtml(actionLabel(event.action))}</b><small>${new Date(event.at).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</small></div><em>${escapeHtml(event.outcome === 'success' ? 'разрешено' : 'отказано')}</em><code>${escapeHtml(event.metadata?.reason ?? event.metadata?.role ?? 'policy checked')}</code></article>`).join('') || '<p class="empty">Нет событий с таким исходом.</p>';
}

function renderDecision(result = null) {
  const decision = $('decision');
  decision.className = `decision ${result?.tone ?? ''}`;
  $('decisionMark').textContent = result ? (result.tone === 'denied' ? '×' : result.tone === 'allowed' ? '✓' : '•') : '—';
  $('decisionTitle').textContent = result?.title ?? 'Готово к проверке';
  $('decisionDetail').textContent = result?.detail ?? 'Выберите действие. Здесь появится решение политики и понятная причина.';
  $('decisionOutcome').textContent = result?.tone ?? 'pending';
  $('decisionCode').textContent = result?.code ?? '—';
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  setTimeout(() => $('toast').classList.remove('show'), 2200);
}

async function run(action) {
  const button = document.querySelector(`[data-action="${action}"]`);
  if (button) button.disabled = true;
  const viewer = state.users.find((user) => user.role === 'viewer') ?? state.users.find((user) => user.role === 'editor');
  const payload = { action, targetId: viewer?.id };
  if (action === 'invite') {
    payload.email = $('inviteEmail').value;
    payload.role = $('inviteRole').value;
  }
  try {
    const data = await api('/api/action', { method: 'POST', body: JSON.stringify(payload) });
    state = data.state;
    renderDecision(data.result);
    renderMembers();
    renderAudit();
    toast(data.result.title);
  } catch (error) {
    renderDecision({ tone:'denied', title:'Действие не выполнено', detail:'Проверьте данные или сбросьте демо.', code:error.message });
  } finally { if (button) button.disabled = false; }
}

document.querySelectorAll('.story').forEach((button) => button.addEventListener('click', () => {
  currentStory = button.dataset.story;
  document.querySelectorAll('.story').forEach((item) => item.classList.toggle('active', item === button));
  renderStory();
  renderDecision();
}));
document.querySelectorAll('[data-filter]').forEach((button) => button.addEventListener('click', () => {
  auditFilter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button));
  renderAudit();
}));
$('reset').addEventListener('click', async () => {
  const data = await api('/api/action', { method:'POST', body:JSON.stringify({ action:'reset' }) });
  state = data.state; renderMembers(); renderAudit(); renderDecision(data.result); toast('Демо сброшено');
});

state = await api('/api/state');
renderStory();
renderMembers();
renderAudit();
renderDecision();
