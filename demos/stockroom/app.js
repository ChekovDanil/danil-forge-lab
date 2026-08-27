import {
  applyImport, attentionQueue, bulkSetStatus, filterProducts, normalizeSku,
  previewImport, setProductStatus, stockDeficit, summarize, undoImport, validateProduct
} from './src/inventory.js';

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const labels = { active: 'Активен', draft: 'Черновик', archived: 'Архив' };

let products = [
  { sku: 'ND-104', name: 'Настольная лампа Form', category: 'Освещение', stock: 3, minimum: 5, price: 4890, status: 'active' },
  { sku: 'FR-208', name: 'Кресло Loop', category: 'Мебель', stock: 12, minimum: 4, price: 16400, status: 'active' },
  { sku: 'ST-076', name: 'Стеллаж Line 03', category: 'Хранение', stock: 2, minimum: 5, price: 12800, status: 'active' },
  { sku: 'AC-310', name: 'Подставка Arc', category: 'Аксессуары', stock: 27, minimum: 8, price: 2190, status: 'draft' },
  { sku: 'TX-441', name: 'Плед North', category: 'Текстиль', stock: 8, minimum: 5, price: 3690, status: 'active' },
  { sku: 'CH-118', name: 'Стул Mono', category: 'Мебель', stock: 0, minimum: 6, price: 7290, status: 'active' },
  { sku: 'VA-090', name: 'Ваза Plume', category: 'Декор', stock: 4, minimum: 2, price: 3490, status: 'archived' }
];

const importRows = [
  { sku: 'ND-104', name: 'Настольная лампа Form', category: 'Освещение', stock: 9, minimum: 5, price: 4890, status: 'active' },
  { sku: 'NW-501', name: 'Органайзер Grid', category: 'Хранение', stock: 4, minimum: 2, price: 2790, status: 'draft' },
  { sku: 'TX-441', name: 'Плед North', category: 'Текстиль', stock: -2, minimum: 5, price: 3690, status: 'active' }
];

let activeFilter = 'all';
let editingSku = '';
let lastImportJournal = null;
const selected = new Set();
const activity = [
  { time: '09:42', title: 'Остатки синхронизированы', text: '7 позиций, без ошибок' },
  { time: 'Вчера', title: 'Подставка Arc сохранена', text: 'Черновик ожидает публикации' },
  { time: '25 авг', title: 'Плед North обновлён', text: 'Остаток: 6 → 8' }
];
let noticeTimer;

function setFilter(filter) {
  activeFilter = filter;
  document.querySelectorAll('[data-filter]').forEach((button) => {
    const active = button.dataset.filter === filter;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  selected.clear();
  render();
}

function notify(message, withUndo = false) {
  clearTimeout(noticeTimer);
  $('notice').querySelector('span').textContent = message;
  $('undo').hidden = !withUndo;
  $('notice').classList.add('visible');
  noticeTimer = window.setTimeout(() => $('notice').classList.remove('visible'), withUndo ? 6500 : 3000);
}

function log(title, text) {
  activity.unshift({ time: 'Сейчас', title, text });
  activity.splice(5);
}

function renderActivity() {
  $('activityLog').innerHTML = activity.map((item) => `<li><time>${escapeHtml(item.time)}</time><div><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.text)}</span></div></li>`).join('');
}

function updateBulk() {
  $('selected').textContent = selected.size;
  $('bulk').classList.toggle('visible', selected.size > 0);
  $('bulkAction').textContent = activeFilter === 'archived' ? 'Восстановить' : 'В архив';
}

function renderAttention() {
  const queue = attentionQueue(products);
  $('attentionList').innerHTML = queue.slice(0, 3).map((item) => `<button data-open="${escapeHtml(item.sku)}"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.sku)} · осталось ${item.stock}</small></span><em>−${item.deficit} до минимума</em></button>`).join('') || '<p>Дефицита нет. Все остатки выше минимума.</p>';
}

function render() {
  const stats = summarize(products);
  $('total').textContent = stats.total;
  $('active').textContent = stats.active;
  $('value').textContent = money(stats.value);
  $('attention').textContent = stats.attention;
  $('deficit').textContent = `${stats.deficit} ед.`;
  renderAttention();

  const rows = filterProducts(products, { query: $('search').value, status: activeFilter });
  $('visibleCount').textContent = `${rows.length} ${rows.length === 1 ? 'позиция' : rows.length < 5 ? 'позиции' : 'позиций'}`;
  $('rows').innerHTML = rows.length ? rows.map((item) => {
    const deficit = stockDeficit(item);
    return `<tr class="${deficit ? 'low' : ''} ${item.status === 'archived' ? 'is-archived' : ''}">
      <td data-label="Выбор"><input type="checkbox" aria-label="Выбрать ${escapeHtml(item.name)}" data-sku="${escapeHtml(item.sku)}" ${selected.has(item.sku) ? 'checked' : ''}></td>
      <td data-label="Товар"><button class="product-link" data-open="${escapeHtml(item.sku)}"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.sku)}</small></button></td>
      <td data-label="Категория">${escapeHtml(item.category)}</td>
      <td data-label="Остаток"><b>${item.stock}</b><small>минимум ${item.minimum}</small>${deficit ? `<em class="deficit">−${deficit} до минимума</em>` : ''}</td>
      <td data-label="Цена">${money(item.price)}</td>
      <td data-label="Статус"><span class="status ${escapeHtml(item.status)}">${labels[item.status]}</span></td>
      <td class="row-action"><button data-open="${escapeHtml(item.sku)}" aria-label="Открыть ${escapeHtml(item.name)}">→</button></td>
    </tr>`;
  }).join('') : '<tr class="empty-row"><td colspan="7"><b>Ничего не найдено</b><small>Измените запрос или вернитесь ко всему каталогу.</small><button id="resetFilters">Показать все товары</button></td></tr>';

  document.querySelectorAll('[data-sku]').forEach((box) => {
    box.onchange = () => { box.checked ? selected.add(box.dataset.sku) : selected.delete(box.dataset.sku); updateBulk(); };
  });
  document.querySelectorAll('[data-open]').forEach((button) => button.onclick = () => openEditor(button.dataset.open));
  $('resetFilters')?.addEventListener('click', () => { $('search').value = ''; setFilter('all'); });
  updateBulk();
  renderActivity();
}

function fillEditor(product) {
  const isNew = !product;
  const serial = String(products.length + 1).padStart(3, '0');
  const item = product ?? { sku: `DR-${serial}`, name: '', category: '', stock: 0, minimum: 1, price: 0, status: 'draft' };
  editingSku = isNew ? '' : item.sku;
  $('originalSku').value = editingSku;
  $('editName').value = item.name;
  $('editSku').value = item.sku;
  $('editCategory').value = item.category;
  $('editStock').value = item.stock;
  $('editMinimum').value = item.minimum;
  $('editPrice').value = item.price;
  $('editorTitle').textContent = isNew ? 'Новый товар' : item.name;
  $('editorEyebrow').textContent = isNew ? 'НОВАЯ ПОЗИЦИЯ' : item.sku;
  $('editorStatus').className = `status ${item.status}`;
  $('editorStatus').textContent = labels[item.status];
  $('editorChanged').textContent = isNew ? 'Будет сохранён как черновик' : 'Изменено сегодня, 09:42';
  $('statusAction').hidden = isNew;
  $('statusAction').textContent = item.status === 'draft' ? 'Опубликовать' : item.status === 'archived' ? 'Восстановить' : 'В архив';
  $('statusAction').className = item.status === 'active' ? 'danger-soft' : 'neutral-soft';
  const deficit = stockDeficit(item);
  $('editorNote').innerHTML = deficit ? `<b>Нужно пополнить</b><span>Добавьте минимум ${deficit} ед., чтобы выйти выше порога.</span>` : '<b>Остаток в норме</b><span>Позиция не требует внимания.</span>';
  $('editor').showModal();
  setTimeout(() => $('editName').focus(), 30);
}

function openEditor(sku = '') {
  fillEditor(sku ? products.find((item) => normalizeSku(item.sku) === normalizeSku(sku)) : null);
}

function closeEditor() { $('editor').close(); }

$('search').oninput = () => { selected.clear(); render(); };
document.querySelectorAll('[data-filter]').forEach((button) => button.onclick = () => setFilter(button.dataset.filter));
$('showAttention').onclick = () => { setFilter('attention'); $('attentionPanel').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
$('scrollTop').onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
$('clearSelection').onclick = () => { selected.clear(); render(); };
$('bulkAction').onclick = () => {
  const nextStatus = activeFilter === 'archived' ? 'active' : 'archived';
  const count = selected.size;
  products = bulkSetStatus(products, [...selected], nextStatus);
  log(nextStatus === 'active' ? 'Товары восстановлены' : 'Товары перенесены в архив', `${count} поз.`);
  selected.clear();
  render();
  notify(nextStatus === 'active' ? 'Выбранные товары восстановлены' : 'Выбранные товары перенесены в архив');
};

$('add').onclick = () => openEditor();
$('closeEditor').onclick = closeEditor;
$('cancelEditor').onclick = closeEditor;
$('editorForm').onsubmit = (event) => {
  event.preventDefault();
  const original = products.find((item) => normalizeSku(item.sku) === normalizeSku(editingSku));
  const candidate = {
    sku: normalizeSku($('editSku').value), name: $('editName').value.trim(), category: $('editCategory').value.trim(),
    price: Number($('editPrice').value), stock: Number($('editStock').value), minimum: Number($('editMinimum').value),
    status: original?.status ?? 'draft'
  };
  const errors = validateProduct(candidate, products, editingSku);
  if (errors.length) { notify(errors[0]); return; }
  if (original) products = products.map((item) => normalizeSku(item.sku) === normalizeSku(editingSku) ? candidate : item);
  else products = [candidate, ...products];
  log(original ? 'Товар обновлён' : 'Создан черновик', `${candidate.name} · ${candidate.sku}`);
  closeEditor();
  setFilter(original ? activeFilter : 'draft');
  notify(original ? 'Изменения сохранены' : 'Черновик создан');
};

$('statusAction').onclick = () => {
  const item = products.find((product) => normalizeSku(product.sku) === normalizeSku(editingSku));
  if (!item) return;
  const next = item.status === 'draft' || item.status === 'archived' ? 'active' : 'archived';
  products = setProductStatus(products, item.sku, next);
  log(next === 'active' ? 'Товар опубликован' : 'Товар перенесён в архив', `${item.name} · ${item.sku}`);
  closeEditor();
  setFilter(next === 'archived' ? 'archived' : 'active');
  notify(next === 'active' ? 'Товар активен' : 'Товар перенесён в архив');
};

$('import').onclick = () => {
  const preview = previewImport(products, importRows);
  const ok = preview.filter((row) => row.errors.length === 0);
  $('importSummary').innerHTML = `<span><b>${preview.length}</b> строк</span><span><b>${ok.length}</b> готовы</span><span><b>${preview.length - ok.length}</b> с ошибкой</span>`;
  $('preview').innerHTML = preview.map((row) => `<article class="preview-row ${row.errors.length ? 'has-error' : ''}">
    <div><span>СТРОКА ${row.row}</span><b>${escapeHtml(row.sku || 'Без артикула')}</b><small>${escapeHtml(row.product.name || 'Название не указано')}</small></div>
    <div class="change">${row.before ? `<span>${row.before.stock} ед.</span><i>→</i><b>${row.after.stock} ед.</b>` : '<span>Новая позиция</span>'}<small>${row.action === 'create' ? 'создать черновик' : 'обновить остаток'}</small></div>
    <em>${row.errors.length ? escapeHtml(row.errors[0]) : row.action === 'create' ? 'Создать' : 'Обновить'}</em>
  </article>`).join('');
  $('apply').textContent = `Применить ${ok.length} строки`;
  $('importDialog').showModal();
};

$('apply').onclick = () => {
  const result = applyImport(products, importRows);
  products = result.products;
  lastImportJournal = result.journal;
  log('Импорт применён', `${result.applied} строки · ${result.skipped} пропущена`);
  render();
  notify(`Импорт завершён: ${result.applied} изменения`, true);
};

$('undo').onclick = () => {
  if (!lastImportJournal) return;
  products = undoImport(products, lastImportJournal);
  lastImportJournal = null;
  log('Импорт отменён', 'Каталог возвращён к предыдущей версии');
  render();
  notify('Импорт отменён');
};

render();
