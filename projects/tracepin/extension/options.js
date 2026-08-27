import { exportClips, exportMarkdown, searchClips } from "./clip-core.js";

let clips = [], selectedId = null;
const els = { list: document.querySelector('#pinList'), empty: document.querySelector('#empty'), detail: document.querySelector('#detailContent'), search: document.querySelector('#search'), type: document.querySelector('#typeFilter'), priority: document.querySelector('#priorityFilter'), allCount: document.querySelector('#allCount'), inboxCount: document.querySelector('#inboxCount'), toast: document.querySelector('#toast'), dialog: document.querySelector('#confirmDialog') };
const send = async (message) => { const response = await chrome.runtime.sendMessage(message); if (!response?.ok) throw new Error(response?.error || 'request_failed'); return response; };
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const notify = (text) => { els.toast.textContent = text; els.toast.classList.add('show'); setTimeout(() => els.toast.classList.remove('show'), 1900); };
const download = (name, type, content) => { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };

function visiblePins() { return searchClips(clips, els.search.value).filter((pin) => els.type.value === 'all' || pin.type === els.type.value).filter((pin) => els.priority.value === 'all' || pin.priority === els.priority.value); }
function renderList() {
  const visible = visiblePins(); els.list.replaceChildren(); els.empty.hidden = visible.length > 0; els.allCount.textContent = clips.length; els.inboxCount.textContent = clips.filter((pin) => pin.status === 'inbox').length;
  visible.forEach((pin) => { const row = node('article', undefined, `pin-row${pin.id === selectedId ? ' active' : ''}`); row.append(node('i', undefined, pin.priority), node('b', pin.quote), node('span', new URL(pin.url).hostname), node('small', pin.tags.map((tag) => `#${tag}`).join(' ') || '—')); row.addEventListener('click', () => { selectedId = pin.id; render(); }); els.list.append(row); });
  if (!selectedId && visible[0]) selectedId = visible[0].id;
}
function renderDetail() {
  const pin = clips.find((item) => item.id === selectedId); els.detail.replaceChildren();
  if (!pin) { els.detail.textContent = 'Выберите правку в списке.'; els.detail.className = 'detail-empty'; return; }
  els.detail.className = 'detail-card'; const title = node('h2', pin.title); const link = node('a', pin.url); link.href = pin.url; link.target = '_blank'; const quote = node('blockquote', pin.quote);
  const type = node('select'); [['text','Текст'],['ui','Интерфейс'],['bug','Ошибка'],['accessibility','Доступность']].forEach(([value,label]) => { const option=node('option',label); option.value=value; option.selected=pin.type===value; type.append(option); });
  const priority = node('select'); [['normal','Обычный'],['important','Важно'],['blocker','Блокирует']].forEach(([value,label]) => { const option=node('option',label); option.value=value; option.selected=pin.priority===value; priority.append(option); });
  const note = node('textarea'); note.value = pin.note; const tags = node('input'); tags.value = pin.tags.join(', ');
  const row = node('div', undefined, 'row'); const typeWrap=node('div'); typeWrap.append(node('label','Тип'),type); const priorityWrap=node('div'); priorityWrap.append(node('label','Приоритет'),priority); row.append(typeWrap,priorityWrap);
  const save=node('button','Сохранить'), remove=node('button','Удалить'), actions=node('div',undefined,'detail-actions'); actions.append(save,remove);
  save.addEventListener('click', async()=>{ const response=await send({type:'UPDATE_PIN',id:pin.id,patch:{note:note.value,tags:tags.value,type:type.value,priority:priority.value}}); clips=response.clips; render(); notify('Правка обновлена'); });
  remove.addEventListener('click',async()=>{ const response=await send({type:'REMOVE_PIN',id:pin.id}); clips=response.clips; selectedId=null; render(); notify('Правка удалена'); });
  els.detail.append(title,link,quote,row,node('label','Теги'),tags,node('label','Комментарий'),note,actions);
}
function render(){renderList();renderDetail()}
async function load(){clips=(await send({type:'GET_STATE'})).clips;render()}
[els.search,els.type,els.priority].forEach((control)=>control.addEventListener(control===els.search?'input':'change',render));
document.querySelector('#exportJson').addEventListener('click',()=>download('tracepin-brief.json','application/json',exportClips(visiblePins())));
document.querySelector('#exportMarkdown').addEventListener('click',()=>download('tracepin-brief.md','text/markdown',exportMarkdown(visiblePins())));
document.querySelector('#clearAll').addEventListener('click',()=>els.dialog.showModal()); document.querySelector('#cancelClear').addEventListener('click',()=>els.dialog.close()); document.querySelector('#confirmClear').addEventListener('click',async()=>{clips=(await send({type:'CLEAR_ALL'})).clips;selectedId=null;els.dialog.close();render();notify('Локальные данные удалены')});
load().catch((error)=>notify(error.message));
