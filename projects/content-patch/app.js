import { PAGES, applyPlan, auditSummary, clonePages, createCheckpoint, createPlan, rollback, visiblePages } from './src/content-core.js';

const $ = (id) => document.getElementById(id);
const labels = { link: 'Ссылка', meta: 'SEO', media: 'Медиа' };
let pages = clonePages(PAGES);
let currentPageId = pages[0].id;
let filter = 'all';
let selected = new Set();
let checkpoint = null;
let reports = [];
let toastTimer;

function esc(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]); }
function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('show'); toastTimer = setTimeout(() => $('toast').classList.remove('show'), 1800); }
function openIssues(page) { return page.issues.filter((issue) => issue.status === 'open'); }

function renderMetrics() {
  const summary = auditSummary(pages);
  $('metrics').innerHTML = `<article><span>Проверено страниц</span><b>${summary.pages}</b><small>синтетическая структура</small></article><article><span>Открытые проблемы</span><b>${summary.open}</b><small>${summary.high} высокого приоритета</small></article><article><span>Исправлено</span><b>${summary.fixed}</b><small>в этой локальной сессии</small></article><article><span>Backup</span><b class="backup-state">${checkpoint ? 'Создан' : 'Не создан'}</b><small>${checkpoint ? esc(checkpoint.id) : 'нужен перед применением'}</small></article>`;
}
function renderPages() {
  const visible = visiblePages(pages, filter); $('pageCount').textContent = visible.length;
  if (!visible.some((page) => page.id === currentPageId) && visible[0]) currentPageId = visible[0].id;
  $('pageList').innerHTML = visible.map((page) => { const open = openIssues(page); return `<button type="button" class="page-row ${page.id === currentPageId ? 'active' : ''}" data-page="${page.id}"><span class="page-state ${open.length ? (open.some((issue) => issue.severity === 'high') ? 'high' : 'medium') : 'clean'}"></span><div><b>${esc(page.title)}</b><small>${esc(page.path)} · ${esc(page.template)}</small></div><strong>${open.length || '✓'}</strong></button>`; }).join('') || '<div class="empty">В этом фильтре страниц нет.</div>';
}
function renderIssues() {
  const page = pages.find((item) => item.id === currentPageId) || pages[0]; $('pageTitle').textContent = page.title; $('pagePath').textContent = `${page.path} · ${page.template}`;
  if (!page.issues.length) { $('issueList').innerHTML = '<div class="clean-page"><span>✓</span><h3>Проблем не найдено</h3><p>Страница готова к контрольному просмотру.</p></div>'; return; }
  $('issueList').innerHTML = page.issues.map((issue) => `<label class="issue ${issue.status}"><input type="checkbox" value="${issue.id}" ${selected.has(issue.id) ? 'checked' : ''} ${issue.status === 'fixed' ? 'disabled' : ''}><span class="checkmark">${issue.status === 'fixed' ? '✓' : ''}</span><div><header><span class="type ${issue.type}">${labels[issue.type]}</span><small class="severity ${issue.severity}">${issue.severity === 'high' ? 'Высокий' : issue.severity === 'medium' ? 'Средний' : 'Низкий'}</small></header><h3>${esc(issue.label)}</h3><p>${esc(issue.detail)}</p></div><b>${issue.status === 'fixed' ? 'Исправлено' : 'Открыто'}</b></label>`).join('');
}
function renderPlan() {
  const plan = createPlan(pages, selected); $('applyButton').disabled = !plan.length || !checkpoint;
  if (!plan.length) { $('planBody').innerHTML = '<div class="plan-empty"><span>0</span><h3>План пока пуст</h3><p>Выберите одну или несколько проблем на странице.</p></div>'; return; }
  $('planBody').innerHTML = `<div class="plan-count"><b>${plan.length}</b><span>изменения готовы<br>к dry-run</span></div><ol>${plan.map((item, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><div><b>${esc(item.pageTitle)}</b><p>${esc(item.action)}</p><small>Обратимо после backup</small></div></li>`).join('')}</ol>${checkpoint ? '<p class="checkpoint-ok">✓ Резервная точка создана</p>' : '<p class="checkpoint-warn">Сначала создайте резервную точку</p>'}`;
}
function renderReport() {
  $('reportCount').textContent = reports.length; $('rollbackButton').disabled = !checkpoint;
  $('reportBody').innerHTML = reports.length ? `<ol class="report-list">${reports.toReversed().map((report) => `<li><span>${esc(report.time)}</span><div><b>${esc(report.title)}</b><p>${esc(report.note)}</p></div></li>`).join('')}</ol>` : '<div class="report-empty"><span>—</span><h3>Действий пока нет</h3><p>Backup, применение и откат появятся здесь.</p></div>';
}
function render() { renderMetrics(); renderPages(); renderIssues(); renderPlan(); renderReport(); }

$('filters').addEventListener('click', (event) => { const button = event.target.closest('[data-filter]'); if (!button) return; filter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach((item) => item.classList.toggle('active', item === button)); render(); });
$('pageList').addEventListener('click', (event) => { const row = event.target.closest('[data-page]'); if (!row) return; currentPageId = row.dataset.page; render(); });
$('issueList').addEventListener('change', (event) => { if (!event.target.matches('input[type="checkbox"]')) return; event.target.checked ? selected.add(event.target.value) : selected.delete(event.target.value); renderPlan(); });
$('selectAllButton').addEventListener('click', () => { const page = pages.find((item) => item.id === currentPageId); for (const issue of openIssues(page)) selected.add(issue.id); render(); });
$('backupButton').addEventListener('click', () => { checkpoint = createCheckpoint(pages); reports.push({ time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), title: 'Создан backup checkpoint', note: checkpoint.id }); toast('Резервная точка создана'); render(); });
$('applyButton').addEventListener('click', () => { const plan = createPlan(pages, selected); try { const result = applyPlan(pages, plan, checkpoint); pages = result.pages; reports.push({ time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), title: `Применено изменений: ${result.report.applied}`, note: `Контрольная точка ${result.report.checkpointId}` }); selected.clear(); toast('Выбранные исправления применены'); render(); } catch { toast('Сначала создайте backup'); } });
$('reportButton').addEventListener('click', () => { renderReport(); $('reportDialog').showModal(); });
$('rollbackButton').addEventListener('click', () => { if (!checkpoint) return; pages = rollback(checkpoint); selected.clear(); reports.push({ time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }), title: 'Выполнен откат', note: `Восстановлено из ${checkpoint.id}` }); checkpoint = null; toast('Состояние восстановлено'); render(); });
$('reportDialog').addEventListener('click', (event) => { if (event.target.closest('[data-close-dialog]') || event.target === $('reportDialog')) $('reportDialog').close(); });

render();
