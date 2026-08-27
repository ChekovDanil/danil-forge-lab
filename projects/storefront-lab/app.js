import { PRODUCTS, addToCart, calculateCart, filterProducts, setCartQuantity } from './src/store-core.js';

const $ = (id) => document.getElementById(id);
const money = (value) => new Intl.NumberFormat('ru-RU').format(value) + ' ₽';
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
let filters = { query: '', category: 'all', sort: 'featured' };
let cart = readCart();
let toastTimer;

function readCart() {
  try { return JSON.parse(localStorage.getItem('forme-demo-cart')) || {}; } catch { return {}; }
}
function saveCart() { localStorage.setItem('forme-demo-cart', JSON.stringify(cart)); }
function productArt(product, compact = false) {
  return `<div class="product-art ${product.tone} ${compact ? 'compact' : ''}" style="--tone:${product.color}"><i></i><span></span><b></b></div>`;
}
function showToast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.add('show');
  toastTimer = setTimeout(() => $('toast').classList.remove('show'), 1800);
}
function renderCatalog() {
  const products = filterProducts(PRODUCTS, filters);
  $('resultCount').textContent = `${products.length} ${products.length === 1 ? 'предмет' : products.length < 5 ? 'предмета' : 'предметов'}`;
  $('productGrid').innerHTML = products.map((product, index) => `<article class="product-card" style="--delay:${index * 35}ms"><button class="visual" type="button" data-view="${product.id}" aria-label="Открыть ${escapeHtml(product.name)}">${productArt(product)}<span>Быстрый просмотр</span></button><div class="product-meta"><div><p>${escapeHtml(product.categoryLabel)}</p><h3>${escapeHtml(product.name)}</h3><small>${escapeHtml(product.note)}</small></div><div><b>${money(product.price)}</b><button type="button" data-add="${product.id}" aria-label="Добавить в корзину">+</button></div></div></article>`).join('');
  $('emptyState').hidden = products.length > 0;
}
function renderCartBadge() { $('cartCount').textContent = calculateCart(cart).count; }
function add(productId) {
  const product = PRODUCTS.find((item) => item.id === productId); if (!product) return;
  cart = addToCart(cart, productId); saveCart(); renderCartBadge(); showToast(`${product.name} добавлен`);
}
function openProduct(productId) {
  const product = PRODUCTS.find((item) => item.id === productId); if (!product) return;
  $('productDialogBody').innerHTML = `<button class="dialog-close" type="button" data-close-product aria-label="Закрыть">×</button><div class="dialog-visual">${productArt(product)}</div><div class="dialog-copy"><p class="eyebrow">${escapeHtml(product.categoryLabel)}</p><h2>${escapeHtml(product.name)}</h2><p>${escapeHtml(product.description)}</p><dl><div><dt>Материал</dt><dd>Алюминий / композит</dd></div><div><dt>Доставка</dt><dd>2–4 рабочих дня</dd></div></dl><footer><b>${money(product.price)}</b><button type="button" data-dialog-add="${product.id}">Добавить в корзину</button></footer></div>`;
  $('productDialog').showModal();
}
function renderCart() {
  const summary = calculateCart(cart); renderCartBadge();
  if (!summary.lines.length) {
    $('cartBody').innerHTML = `<div class="cart-empty"><span>0</span><h3>Корзина пока пуста</h3><p>Добавьте предметы из каталога — выбор сохранится в этом браузере.</p><button type="button" data-close-cart>Вернуться к каталогу</button></div>`; return;
  }
  $('cartBody').innerHTML = `<div class="cart-lines">${summary.lines.map(({ product, quantity, total }) => `<article class="cart-line">${productArt(product, true)}<div class="line-copy"><p>${escapeHtml(product.categoryLabel)}</p><h3>${escapeHtml(product.name)}</h3><button type="button" data-remove="${product.id}">Удалить</button></div><div class="quantity"><button type="button" data-quantity="${product.id}" data-value="${quantity - 1}" aria-label="Уменьшить">−</button><b>${quantity}</b><button type="button" data-quantity="${product.id}" data-value="${quantity + 1}" aria-label="Увеличить">+</button></div><strong>${money(total)}</strong></article>`).join('')}</div><aside class="cart-summary"><div><span>Товары</span><b>${money(summary.subtotal)}</b></div><div><span>Доставка</span><b>${summary.shipping ? money(summary.shipping) : 'Бесплатно'}</b></div><div class="grand"><span>Итого</span><b>${money(summary.total)}</b></div><p>${summary.subtotal < 15000 ? `До бесплатной доставки ${money(15000 - summary.subtotal)}` : 'Бесплатная доставка включена'}</p><button type="button" id="checkoutButton">Оформить демо-заказ</button><small>Оплата не производится. Все данные синтетические.</small></aside>`;
}
function openCart() { renderCart(); $('cartDialog').showModal(); }
function closeDialog(dialog) { if (dialog.open) dialog.close(); }
function checkout() {
  const order = `DF-${String(Date.now()).slice(-6)}`; cart = {}; saveCart(); renderCart();
  $('cartBody').innerHTML = `<div class="success"><span>✓</span><p class="eyebrow">ДЕМО-ЗАКАЗ ${order}</p><h3>Заказ собран</h3><p>Состояние завершено локально. Платёж и отправка данных не выполнялись.</p><button type="button" data-close-cart>Готово</button></div>`; renderCartBadge();
}

$('searchInput').addEventListener('input', (event) => { filters.query = event.target.value; renderCatalog(); });
$('sortSelect').addEventListener('change', (event) => { filters.sort = event.target.value; renderCatalog(); });
$('categoryChips').addEventListener('click', (event) => { const button = event.target.closest('[data-category]'); if (!button) return; filters.category = button.dataset.category; document.querySelectorAll('[data-category]').forEach((item) => item.classList.toggle('active', item === button)); renderCatalog(); });
$('productGrid').addEventListener('click', (event) => { const addButton = event.target.closest('[data-add]'); const viewButton = event.target.closest('[data-view]'); if (addButton) add(addButton.dataset.add); else if (viewButton) openProduct(viewButton.dataset.view); });
$('productDialog').addEventListener('click', (event) => { const addButton = event.target.closest('[data-dialog-add]'); if (addButton) { add(addButton.dataset.dialogAdd); closeDialog($('productDialog')); } if (event.target.closest('[data-close-product]')) closeDialog($('productDialog')); });
$('cartButton').addEventListener('click', openCart);
$('cartDialog').addEventListener('click', (event) => { if (event.target.closest('[data-close-cart]')) closeDialog($('cartDialog')); const remove = event.target.closest('[data-remove]'); if (remove) { cart = setCartQuantity(cart, remove.dataset.remove, 0); saveCart(); renderCart(); } const quantity = event.target.closest('[data-quantity]'); if (quantity) { cart = setCartQuantity(cart, quantity.dataset.quantity, quantity.dataset.value); saveCart(); renderCart(); } if (event.target.closest('#checkoutButton')) checkout(); });
$('resetFilters').addEventListener('click', () => { filters = { query: '', category: 'all', sort: 'featured' }; $('searchInput').value = ''; $('sortSelect').value = 'featured'; document.querySelectorAll('[data-category]').forEach((item) => item.classList.toggle('active', item.dataset.category === 'all')); renderCatalog(); });
for (const dialog of document.querySelectorAll('dialog')) dialog.addEventListener('click', (event) => { if (event.target === dialog) closeDialog(dialog); });

renderCatalog(); renderCartBadge();
