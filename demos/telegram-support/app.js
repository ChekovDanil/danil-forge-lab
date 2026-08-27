import { SupportDesk, categoryPolicies, statusLabels } from './src/support-core.js';
import { markHorizontalOverflow } from './src/layout-invariant.js';

const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const clock = (() => { let value = new Date('2026-08-27T09:00:00.000Z'); return { now: () => new Date(value), add: (minutes) => { value = new Date(value.getTime() + minutes * 60_000); } }; })();
const desk = new SupportDesk({ now: clock.now, idFactory: (() => { let id = 1020; return () => String(++id); })() });
let selectedId = null;
let filter = 'active';
let toastTimer;

function toast(text) { clearTimeout(toastTimer); $('toast').textContent = text; $('toast').classList.add('show'); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 2300); }
function time(value) { return new Intl.DateTimeFormat('ru-RU',{hour:'2-digit',minute:'2-digit'}).format(new Date(value)); }
function remaining(ticket) { const minutes = Math.max(0, Math.round((new Date(ticket.sla.dueAt) - clock.now()) / 60_000)); return ticket.sla.breached ? 'SLA нарушен' : `${minutes} мин до ответа`; }
function active(ticket) { return !['resolved','closed'].includes(ticket.status); }

function seed() {
  const first = desk.intake({ name:'Демо-пользователь', contact:'@demo_user_000001', category:'technical', message:'После обновления не загружается список проектов, вижу пустой экран.', impact:'single' });
  desk.transition(first.id,'in_progress',{ actor:'Илья',note:'Проверяю версию приложения' });
  const second = desk.intake({ name:'Михаил', contact:'mikhail@example.invalid', category:'payment', message:'Оплата прошла дважды, нужен возврат второй операции.', impact:'single', customerTier:'priority' });
  const third = desk.intake({ name:'Демо-команда', contact:'@demo_team_000002', category:'access', message:'Несколько сотрудников потеряли доступ к рабочему кабинету.', impact:'many', blocked:true });
  desk.escalate(third.id,'Затронуто несколько сотрудников, требуется проверка администратора.');
  selectedId = second.id;
}

function visibleTickets() {
  return desk.list().filter((ticket) => filter === 'all' || filter === 'human' ? (filter === 'all' || ticket.humanRequired) : active(ticket));
}

function renderQueue() {
  const all = desk.list(), items = visibleTickets();
  $('metricQueue').textContent = all.filter(active).length;
  $('metricPriority').textContent = all.filter((ticket) => active(ticket) && ['high','critical'].includes(ticket.priority.code)).length;
  $('metricHuman').textContent = all.filter((ticket) => active(ticket) && ticket.humanRequired).length;
  $('queueCount').textContent = items.length;
  $('ticketList').innerHTML = items.length ? items.map((ticket) => `<button class="ticket ${ticket.id===selectedId?'selected':''}" data-id="${ticket.id}"><span class="priority-dot ${ticket.priority.code}"></span><div><div class="ticket-top"><b>${esc(ticket.customer.name)}</b><time>${time(ticket.history[0].at)}</time></div><p>${esc(categoryPolicies[ticket.category].label)} · ${esc(ticket.message)}</p><footer><span>${esc(statusLabels[ticket.status])}</span><small class="${ticket.sla.breached?'breached':''}">${esc(remaining(ticket))}</small></footer></div></button>`).join('') : '<div class="queue-empty">В этом разделе обращений нет.</div>';
  document.querySelectorAll('.ticket').forEach((button) => button.onclick = () => { selectedId=button.dataset.id; render(); });
}

function renderDetail() {
  const ticket = desk.get(selectedId);
  if (!ticket) { $('detailPanel').innerHTML='<div class="empty-state"><span>01</span><h2>Выберите обращение</h2><p>Здесь появятся контекст, маршрут, SLA и готовый ответ.</p></div>'; return; }
  $('detailPanel').innerHTML = `<header class="detail-head"><div><p>${esc(ticket.id)} · ${esc(categoryPolicies[ticket.category].label)}</p><h2>${esc(ticket.customer.name)}</h2><small>${esc(ticket.customer.contact)}</small></div><span class="priority-label ${ticket.priority.code}">${esc(ticket.priority.label)}</span></header>
    <div class="request"><span>СООБЩЕНИЕ КЛИЕНТА</span><p>${esc(ticket.message)}</p></div>
    <dl class="route"><div><dt>Команда</dt><dd>${esc(ticket.route.team)}</dd></div><div><dt>Ответственный</dt><dd>${esc(ticket.assignee)}</dd></div><div><dt>Статус</dt><dd>${esc(statusLabels[ticket.status])}</dd></div><div><dt>SLA</dt><dd class="${ticket.sla.breached?'breached':''}">${esc(remaining(ticket))}</dd></div></dl>
    ${ticket.humanRequired?`<div class="escalation"><span>НУЖЕН СПЕЦИАЛИСТ</span><p>${esc(ticket.escalationReason || 'Срок первого ответа истёк.')}</p></div>`:''}
    <div class="reply"><header><span>ЧЕРНОВИК ОТВЕТА</span><button id="copyReply">Копировать</button></header><p>${esc(ticket.suggestedReply)}</p></div>
    <footer class="actions">${ticket.status==='triaged'?'<button data-action="start" class="primary">Взять в работу</button>':''}${['in_progress','waiting_customer'].includes(ticket.status)?'<button data-action="resolve" class="primary">Отметить решённым</button>':''}${['triaged','in_progress','waiting_customer'].includes(ticket.status)?'<button data-action="escalate">Передать человеку</button>':''}${ticket.status==='escalated'?'<button data-action="start" class="primary">Принять специалисту</button>':''}</footer>`;
  $('copyReply').onclick=async()=>{try{if(!navigator.clipboard)throw new Error('clipboard_unavailable');await navigator.clipboard.writeText(ticket.suggestedReply);toast('Черновик скопирован');}catch{toast('Копирование недоступно — выделите текст вручную');}};
  document.querySelectorAll('[data-action]').forEach((button)=>button.onclick=()=>handleAction(ticket,button.dataset.action));
}

function handleAction(ticket, action) {
  if(action==='start') desk.transition(ticket.id,'in_progress',{actor:'Оператор',note:'Обращение принято в работу'});
  if(action==='resolve') desk.transition(ticket.id,'resolved',{actor:'Оператор',note:'Решение подтверждено'});
  if(action==='escalate') desk.escalate(ticket.id,'Требуется решение специалиста и проверка контекста.','Оператор');
  toast(action==='resolve'?'Обращение решено':action==='escalate'?'Передано специалисту':'Работа начата'); render();
}

function renderHistory() {
  const ticket=desk.get(selectedId);
  $('historyCount').textContent=ticket?ticket.history.length:'—';
  $('history').innerHTML=ticket?[...ticket.history].reverse().map((event,index)=>`<li class="${index===0?'current':''}"><i></i><div><b>${esc(statusLabels[event.status])}</b><small>${esc(event.note||event.actor)}</small><time>${time(event.at)}</time></div></li>`).join(''):'<li class="history-empty">Статусы появятся после выбора обращения.</li>';
}

function checkLayout(){requestAnimationFrame(()=>{const result=markHorizontalOverflow(document.documentElement,window.innerWidth);if(!result.pass)console.warn('Horizontal overflow detected',result);});}
function render(){renderQueue();renderDetail();renderHistory();checkLayout();}

document.querySelectorAll('[data-filter]').forEach((button)=>button.onclick=()=>{filter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach((item)=>item.classList.toggle('active',item===button));renderQueue();});
$('newTicket').onclick=()=>$('ticketDialog').showModal();
$('ticketForm').onsubmit=(event)=>{if(event.submitter?.value==='cancel')return;event.preventDefault();const form=new FormData(event.currentTarget);try{const ticket=desk.intake({name:form.get('name'),contact:form.get('contact'),category:form.get('category'),impact:form.get('impact'),message:form.get('message'),blocked:form.get('blocked')==='on',source:'telegram-demo'});selectedId=ticket.id;$('ticketDialog').close();toast('Обращение распределено');render();}catch(error){toast(error.message);}};

window.addEventListener('resize',checkLayout,{passive:true});
seed();render();
