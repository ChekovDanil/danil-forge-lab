export const PAGES = Object.freeze([
  { id: 'home', title: 'Главная', path: '/', template: 'Landing', issues: [
    { id: 'home-link', type: 'link', label: 'Ссылка на старый каталог', detail: '/catalog-old → /catalog', severity: 'high', status: 'open' },
    { id: 'home-hero', type: 'media', label: 'Тяжёлое hero-изображение', detail: '3.8 МБ · рекомендуется WebP', severity: 'medium', status: 'open' }
  ]},
  { id: 'catalog', title: 'Каталог', path: '/catalog', template: 'Archive', issues: [
    { id: 'catalog-alt', type: 'meta', label: 'Нет alt у 4 изображений', detail: 'Использовать названия товаров', severity: 'medium', status: 'open' },
    { id: 'catalog-description', type: 'meta', label: 'Нет meta description', detail: 'Сформировать из заголовка и вводного текста', severity: 'low', status: 'open' }
  ]},
  { id: 'delivery', title: 'Доставка', path: '/delivery', template: 'Page', issues: [
    { id: 'delivery-link', type: 'link', label: 'Внешняя ссылка отвечает 404', detail: 'example.invalid/terms', severity: 'high', status: 'open' }
  ]},
  { id: 'journal', title: 'Журнал', path: '/journal', template: 'Posts', issues: [
    { id: 'journal-image', type: 'media', label: '3 изображения больше 2 МБ', detail: 'Суммарно 8.4 МБ', severity: 'medium', status: 'open' }
  ]},
  { id: 'contacts', title: 'Контакты', path: '/contacts', template: 'Page', issues: [] }
]);

export function clonePages(pages = PAGES) { return structuredClone(pages); }

export function auditSummary(pages) {
  const issues = pages.flatMap((page) => page.issues);
  const open = issues.filter((issue) => issue.status === 'open');
  return {
    pages: pages.length,
    total: issues.length,
    open: open.length,
    fixed: issues.length - open.length,
    high: open.filter((issue) => issue.severity === 'high').length,
    byType: Object.fromEntries(['link', 'meta', 'media'].map((type) => [type, open.filter((issue) => issue.type === type).length]))
  };
}

export function visiblePages(pages, filter = 'all') {
  if (filter === 'all') return pages;
  if (filter === 'clean') return pages.filter((page) => page.issues.every((issue) => issue.status === 'fixed') || page.issues.length === 0);
  return pages.filter((page) => page.issues.some((issue) => issue.status === 'open' && issue.type === filter));
}

export function createPlan(pages, selectedIds) {
  const selected = new Set(selectedIds);
  return pages.flatMap((page) => page.issues.filter((issue) => selected.has(issue.id) && issue.status === 'open').map((issue) => ({
    issueId: issue.id,
    pageId: page.id,
    pageTitle: page.title,
    type: issue.type,
    action: issue.type === 'link' ? 'Обновить или отключить ссылку' : issue.type === 'meta' ? 'Добавить безопасное метаполе' : 'Подготовить оптимизированную копию',
    reversible: true
  })));
}

export function createCheckpoint(pages, now = new Date().toISOString()) {
  return { id: `backup-${now.replace(/\D/g, '').slice(0, 14)}`, createdAt: now, pages: clonePages(pages) };
}

export function applyPlan(pages, plan, checkpoint) {
  if (!checkpoint) throw new Error('backup_required');
  const selected = new Set(plan.map((item) => item.issueId));
  const next = clonePages(pages);
  for (const page of next) for (const issue of page.issues) if (selected.has(issue.id)) issue.status = 'fixed';
  return { pages: next, report: { applied: plan.length, checkpointId: checkpoint.id, issueIds: [...selected] } };
}

export function rollback(checkpoint) {
  if (!checkpoint?.pages) throw new Error('checkpoint_required');
  return clonePages(checkpoint.pages);
}
