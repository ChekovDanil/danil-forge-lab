import { IntakeSession, budgets, routeLead, urgencyOptions } from '/src/intake.js';

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const steps = { name:1, contact:2, category:3, description:4, budget:5, urgency:6, confirm:6, complete:6, cancelled:1 };
const eventLabels = { session_started:'Диалог начат', step_completed:'Ответ сохранён', lead_created:'Карточка создана', cancelled:'Заявка отменена' };
let session;
let toastTimer;

function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('visible');toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2600);}
function bubble(text,role,error=false){const node=document.createElement('div');node.className=`bubble ${role}${error?' error':''}`;node.textContent=text;$('chat').append(node);$('chat').scrollTop=$('chat').scrollHeight;}

function renderRoute(){
  const lead=session.lead();
  const preview=session.data.category?routeLead(session.data.category):null;
  const route=lead?.route??preview;
  const values=route?[route.team,route.owner,route.channel,lead?.priority.sla??'Определится после срока']:['Определится по категории','—','—','—'];
  $('routeDetails').innerHTML=['Команда','Ответственный','Канал','SLA'].map((label,index)=>`<div><dt>${label}</dt><dd>${escapeHtml(values[index])}</dd></div>`).join('');
}

function renderEvents(){
  $('eventCount').textContent=`${session.events.length} ${session.events.length===1?'событие':session.events.length<5?'события':'событий'}`;
  $('eventLog').innerHTML=[...session.events].reverse().slice(0,7).map((event,index)=>`<li class="${index===0?'current':''}"><i></i><div><b>${eventLabels[event.type]??event.type}</b><small>${event.step?`Этап: ${event.step}`:event.route?`${event.route} · ${event.priority==='high'?'высокий приоритет':'обычный приоритет'}`:'только что'}</small></div></li>`).join('');
}

function renderLead(){
  const lead=session.lead();
  $('leadActions').hidden=!lead;
  if(!lead){$('leadStatus').className='lead-status empty';$('leadStatus').textContent='Собирается';$('leadCard').className='lead-empty';$('leadCard').innerHTML='<span>01</span><b>Карточка появится после подтверждения</b><p>В ней будут задача, контакт, бюджет, маршрут и следующий шаг.</p>';return;}
  $('leadStatus').className=`lead-status ${lead.priority.code}`;$('leadStatus').textContent=lead.priority.code==='high'?'Высокий приоритет':'Новая';
  $('leadCard').className='lead-card';
  $('leadCard').innerHTML=`<div class="lead-top"><div><small>${escapeHtml(lead.id)}</small><h3>${escapeHtml(lead.request.category)}</h3></div><span>${escapeHtml(lead.request.budget)}</span></div><p class="request-copy">${escapeHtml(lead.request.description)}</p><div class="client"><span>${escapeHtml(lead.client.name.slice(0,1).toUpperCase())}</span><div><b>${escapeHtml(lead.client.name)}</b><small>${escapeHtml(lead.client.contact)}</small></div></div><dl><div><dt>Команда</dt><dd>${escapeHtml(lead.route.team)}</dd></div><div><dt>Ответственный</dt><dd>${escapeHtml(lead.route.owner)}</dd></div><div><dt>Срок ответа</dt><dd>${escapeHtml(lead.priority.sla.replace('Ответить ',''))}</dd></div><div><dt>Канал</dt><dd>${escapeHtml(lead.route.channel)}</dd></div></dl><div class="next-action"><span>Следующий шаг</span><b>${escapeHtml(lead.nextAction)}</b></div>`;
}

function renderState(){
  $('chatStep').textContent=session.finished?'Диалог завершён':`Шаг ${steps[session.step]??1} из 6`;
  renderLead();renderRoute();renderEvents();
}

function show(response){
  bubble(response.text,'bot');
  if(response.error)bubble(response.error,'bot',true);
  document.querySelectorAll('.options button').forEach((button)=>button.disabled=true);
  const options=document.createElement('div');options.className='options';
  (response.options||[]).forEach((label)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.onclick=()=>send(label);options.append(button);});
  $('chat').append(options);$('chat').scrollTop=$('chat').scrollHeight;renderState();
}

function send(value){if(!String(value).trim())return;bubble(value,'user');show(session.handle(value));$('message').value='';}

function reset(){session=new IntakeSession();$('chat').innerHTML='';show(session.prompt());renderState();}

function quickDemo(urgent){
  reset();
  const answers=['Марина','marina@example.invalid','Telegram-бот','Нужен бот для заявок с сайта и уведомлений менеджеру',budgets[1],urgent?urgencyOptions[0]:urgencyOptions[1],'Отправить заявку'];
  answers.forEach(send);
  toast(urgent?'Срочная заявка направлена с SLA 30 минут':'Обычная заявка направлена ответственному');
}

$('form').onsubmit=(event)=>{event.preventDefault();send($('message').value);};
$('restart').onclick=reset;
$('demoNormal').onclick=()=>quickDemo(false);
$('demoUrgent').onclick=()=>quickDemo(true);
$('takeWork').onclick=()=>{$('leadStatus').className='lead-status active';$('leadStatus').textContent='В работе';toast('Заявка передана в работу');};
$('askClarification').onclick=()=>{$('leadStatus').className='lead-status clarification';$('leadStatus').textContent='Нужно уточнить';toast('Клиенту подготовлен уточняющий вопрос');};
reset();
