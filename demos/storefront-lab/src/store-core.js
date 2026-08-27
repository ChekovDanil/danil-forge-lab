export const PRODUCTS = Object.freeze([
  { id: 'arc-lamp', name: 'Arc Lamp 02', category: 'light', categoryLabel: 'Свет', price: 12900, color: '#d6a86f', tone: 'sand', note: 'Тёплый направленный свет', description: 'Настольный светильник с поворотным плафоном и мягким рассеивателем. Три уровня яркости сохраняются локально на устройстве.' },
  { id: 'fold-tray', name: 'Fold Tray', category: 'desk', categoryLabel: 'Рабочее место', price: 3400, color: '#6c7b73', tone: 'sage', note: 'Порядок без лишних деталей', description: 'Алюминиевый лоток для заметок, кабелей и небольших устройств. Складывается в плоский профиль для хранения.' },
  { id: 'still-clock', name: 'Still Clock', category: 'objects', categoryLabel: 'Объекты', price: 7200, color: '#3e4548', tone: 'slate', note: 'Тихий ход, матовый корпус', description: 'Компактные настольные часы с бесшумным механизмом и контрастными метками без декоративного шума.' },
  { id: 'line-stand', name: 'Line Stand', category: 'desk', categoryLabel: 'Рабочее место', price: 5900, color: '#a67b62', tone: 'clay', note: 'Подставка для ноутбука', description: 'Устойчивая подставка из анодированного алюминия. Поднимает экран и оставляет пространство для клавиатуры.' },
  { id: 'halo-light', name: 'Halo Light', category: 'light', categoryLabel: 'Свет', price: 9800, color: '#8a7760', tone: 'umber', note: 'Мягкий свет для вечера', description: 'Переносной светильник с автономной работой до восьми часов и плавной регулировкой интенсивности.' },
  { id: 'mono-vase', name: 'Mono Vase', category: 'objects', categoryLabel: 'Объекты', price: 4100, color: '#9ba09a', tone: 'mist', note: 'Ручная матовая фактура', description: 'Небольшая керамическая ваза с тактильной поверхностью. Каждый экземпляр имеет естественные отличия оттенка.' }
]);

export function filterProducts(products, options = {}) {
  const query = String(options.query || '').trim().toLocaleLowerCase('ru');
  const category = options.category || 'all';
  const maxPrice = Number(options.maxPrice) || Infinity;
  const sort = options.sort || 'featured';
  const visible = products.filter((product) => {
    const haystack = `${product.name} ${product.note} ${product.categoryLabel}`.toLocaleLowerCase('ru');
    return (category === 'all' || product.category === category) && product.price <= maxPrice && (!query || haystack.includes(query));
  });
  if (sort === 'price-asc') return visible.toSorted((a, b) => a.price - b.price);
  if (sort === 'price-desc') return visible.toSorted((a, b) => b.price - a.price);
  return visible;
}

export function addToCart(cart, productId) {
  const next = { ...cart };
  next[productId] = Math.min(9, (Number(next[productId]) || 0) + 1);
  return next;
}

export function setCartQuantity(cart, productId, quantity) {
  const next = { ...cart };
  const safeQuantity = Math.max(0, Math.min(9, Number(quantity) || 0));
  if (!safeQuantity) delete next[productId];
  else next[productId] = safeQuantity;
  return next;
}

export function calculateCart(cart, products = PRODUCTS) {
  const lines = Object.entries(cart).flatMap(([productId, quantity]) => {
    const product = products.find((item) => item.id === productId);
    const safeQuantity = Math.max(0, Math.min(9, Number(quantity) || 0));
    return product && safeQuantity ? [{ product, quantity: safeQuantity, total: product.price * safeQuantity }] : [];
  });
  const count = lines.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = lines.reduce((sum, line) => sum + line.total, 0);
  const shipping = subtotal === 0 || subtotal >= 15000 ? 0 : 490;
  return { lines, count, subtotal, shipping, total: subtotal + shipping };
}
