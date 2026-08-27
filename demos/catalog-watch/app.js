import { compareSnapshots, comparisonToCsv, parseHtmlFixture, parseJsonFixture, trackedFieldLabels } from './src/catalog-watch.js';

const htmlFixture = `<section class="catalog">
  <article data-sku="CT-201" data-price="2490" data-state="available" data-revision="1"><h3>Лампа Orbit</h3></article>
  <article data-sku="CT-202" data-price="990" data-state="available" data-revision="1"><h3>Кружка Stone</h3></article>
  <article data-sku="CT-203" data-price="1490" data-state="limited" data-revision="1"><h3>Поднос Form</h3></article>
  <article data-sku="CT-204" data-price="4990" data-state="available" data-revision="1"><h3>Полка Line</h3></article>
  <article data-sku="CT-205" data-price="1990" data-state="unavailable" data-revision="1"><h3>Ваза Mono</h3></article>
</section>`;

const jsonFixture = JSON.stringify([
  { sku:'CT-201', title:'Лампа Orbit', price:2490, state:'available', revision:2 },
  { sku:'CT-202', title:'Кружка Stone', price:1090, state:'available', revision:2 },
  { sku:'CT-204', title:'Полка Line', price:4990, state:'available', revision:1 },
  { sku:'CT-204', title:'Полка Line', price:4990, state:'limited', revision:2 },
  { sku:'CT-205', title:'Ваза Mono', price:1990, state:'unavailable', revision:2 },
  { sku:'CT-206', title:'Столик Arc', price:7490, state:'available', revision:1 }
], null, 2);

const statusLabels = { new:'Новая запись', changed:'Изменено', removed:'Удалено', unchanged:'Без изменений' };
const stateLabels = { available:'В наличии', limited:'Осталось мало', unavailable:'Нет в наличии' };
const selected = new Set(['title','price','state']);
let comparison = null;
let activeFilter = 'all';
let toastTimer;
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
const valueLabel = (field, value) => field === 'price' ? `${new Intl.NumberFormat('ru-RU').format(value)} ₽` : field === 'state' ? (stateLabels[value] ?? value) : value;

function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('visible');toastTimer=setTimeout(()=>$('toast').classList.remove('visible'),2200)}

function renderFixtures(){
  $('htmlPreview').textContent = `<article data-sku="CT-201"\n data-price="2490">\n  <h3>Лампа Orbit</h3>\n</article>\n\n… ещё 4 записи`;
  $('jsonPreview').textContent = `[{\n  "sku": "CT-202",\n  "price": 1090,\n  "state": "available"\n},\n… ещё 5 строк]`;
}

function renderFields(){
  $('fieldList').innerHTML=Object.entries(trackedFieldLabels).map(([field,label])=>`<label><input type="checkbox" value="${field}" ${selected.has(field)?'checked':''}><span><b>${label}</b><small>${field==='title'?'точное совпадение текста':field==='price'?'сравнение числового значения':'изменение доступности'}</small></span><i></i></label>`).join('');
  $('fieldList').querySelectorAll('input').forEach((input)=>input.addEventListener('change',()=>{input.checked?selected.add(input.value):selected.delete(input.value);$('compareButton').disabled=selected.size===0;}));
}

function filteredRows(){return !comparison?[]:activeFilter==='all'?comparison.rows:comparison.rows.filter((row)=>row.status===activeFilter)}

function renderResults(){
  if(!comparison)return;
  $('totalMetric').textContent=comparison.summary.total;$('newMetric').textContent=comparison.summary.new;$('changedMetric').textContent=comparison.summary.changed;$('removedMetric').textContent=comparison.summary.removed;
  const rows=filteredRows();$('countLabel').textContent=`${rows.length} из ${comparison.rows.length} записей`;
  $('changeList').innerHTML=rows.map((row)=>{const current=row.newRow??row.oldRow;const changes=row.changes.map((change)=>`<li><span>${trackedFieldLabels[change.field]}</span><del>${escapeHtml(valueLabel(change.field,change.before))}</del><b>→</b><ins>${escapeHtml(valueLabel(change.field,change.after))}</ins></li>`).join('');return `<article class="change-card ${row.status}"><header><div><span class="sku">${escapeHtml(row.sku)}</span><h3>${escapeHtml(current.title)}</h3></div><em>${statusLabels[row.status]}</em></header>${changes?`<ul>${changes}</ul>`:`<p>${row.status==='new'?'Позиция появилась в новом снимке.':row.status==='removed'?'Позиция отсутствует в новом снимке.':'Выбранные поля не изменились.'}</p>`}</article>`}).join('');
  $('emptyState').hidden=true;$('changeList').hidden=false;$('exportButton').disabled=false;
}

function runComparison(){comparison=compareSnapshots(parseHtmlFixture(htmlFixture),parseJsonFixture(jsonFixture),[...selected]);activeFilter='all';document.querySelectorAll('[data-filter]').forEach((button)=>{const active=button.dataset.filter==='all';button.classList.toggle('active',active);button.setAttribute('aria-pressed',active)});renderResults();$('results').scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});toast(`Найдено изменений: ${comparison.summary.new+comparison.summary.changed+comparison.summary.removed}`)}

function exportCsv(){const csv=`\uFEFF${comparisonToCsv(comparison.rows)}`,url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=Object.assign(document.createElement('a'),{href:url,download:'catalog-watch-changes.csv'});link.click();URL.revokeObjectURL(url);toast('CSV подготовлен локально')}

function reset(){selected.clear();['title','price','state'].forEach((field)=>selected.add(field));comparison=null;activeFilter='all';renderFields();$('emptyState').hidden=false;$('changeList').hidden=true;$('exportButton').disabled=true;['totalMetric','newMetric','changedMetric','removedMetric'].forEach((id)=>$(id).textContent='—');$('countLabel').textContent='Сравнение не запущено';toast('Демо сброшено')}

$('compareButton').addEventListener('click',runComparison);$('exportButton').addEventListener('click',exportCsv);$('resetButton').addEventListener('click',reset);document.querySelectorAll('[data-filter]').forEach((button)=>button.addEventListener('click',()=>{activeFilter=button.dataset.filter;document.querySelectorAll('[data-filter]').forEach((item)=>{const active=item===button;item.classList.toggle('active',active);item.setAttribute('aria-pressed',active)});renderResults()}));renderFixtures();renderFields();
