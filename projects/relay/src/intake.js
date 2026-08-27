export const categories = ['Сайт', 'Telegram-бот', 'Автоматизация', 'Другое'];
export const budgets = ['До 20 000 ₽', '20–60 000 ₽', 'От 60 000 ₽', 'Нужно оценить'];
export const urgencyOptions = ['Срочно — ответ сегодня', 'Срок обсуждается'];

const routes = {
  'Сайт': { team: 'Веб-команда', owner: 'Алексей', channel: '#web-leads' },
  'Telegram-бот': { team: 'Автоматизация', owner: 'Ирина', channel: '#automation' },
  'Автоматизация': { team: 'Интеграции', owner: 'Ирина', channel: '#automation' },
  'Другое': { team: 'Первичная оценка', owner: 'Менеджер', channel: '#new-leads' }
};

export function routeLead(category) {
  return { ...(routes[category] ?? routes['Другое']) };
}

export function leadPriority(urgency) {
  return urgency === urgencyOptions[0] ? { code: 'high', label: 'Высокий', sla: 'Ответить за 30 минут' } : { code: 'normal', label: 'Обычный', sla: 'Ответить в течение дня' };
}

export function buildLead(data) {
  const route = routeLead(data.category);
  const priority = leadPriority(data.urgency);
  return {
    id: data.id,
    createdAt: data.createdAt,
    client: { name: data.name, contact: data.contact },
    request: { category: data.category, description: data.description, budget: data.budget, urgency: data.urgency },
    route,
    priority,
    nextAction: `${route.owner}: ${priority.sla.toLowerCase()}`,
    tags: [data.category, data.budget, priority.label]
  };
}

export class IntakeSession {
  constructor({ now = () => new Date(), idFactory = () => crypto.randomUUID().slice(0, 8).toUpperCase() } = {}) {
    this.now = now;
    this.idFactory = idFactory;
    this.reset();
  }
  reset() { this.step = 'name'; this.data = {}; this.finished = false; this.events = [{ type: 'session_started', at: this.now().toISOString() }]; }
  prompt() {
    const prompts = {
      name: { text: 'Как к вам обращаться?', options: [] },
      contact: { text: `Спасибо, ${this.data.name}. Пришлите телефон или email для связи.`, options: [] },
      category: { text: 'Что требуется сделать?', options: categories },
      description: { text: 'Коротко опишите задачу и ожидаемый результат.', options: [] },
      budget: { text: 'Какой бюджет планируете?', options: budgets },
      urgency: { text: 'Когда нужен первый ответ?', options: urgencyOptions },
      confirm: { text: this.summary(), options: ['Отправить заявку', 'Изменить описание', 'Отменить'] },
      complete: { text: this.finished ? `Заявка ${this.data.id} принята. ${this.lead().route.owner} получит её вместе с контекстом и контактом.` : 'Заявка принята.', options: ['Новая заявка'] },
      cancelled: { text: 'Заявка отменена. Данные не сохранены.', options: ['Начать заново'] }
    };
    return prompts[this.step];
  }
  summary() {
    return `Проверьте заявку:\nКатегория: ${this.data.category}\nЗадача: ${this.data.description}\nБюджет: ${this.data.budget}\nСрок: ${this.data.urgency}\nКонтакт: ${this.data.contact}`;
  }
  advance(from, to) { this.events.push({ type: 'step_completed', step: from, at: this.now().toISOString() }); this.step = to; }
  handle(raw) {
    const value = String(raw ?? '').trim();
    if (value === '/cancel' || value === 'Отменить') { this.events.push({ type: 'cancelled', at: this.now().toISOString() }); this.step = 'cancelled'; this.data = {}; return this.prompt(); }
    if ((value === '/start' || value === 'Начать заново' || value === 'Новая заявка') && ['cancelled', 'complete'].includes(this.step)) { this.reset(); return this.prompt(); }
    if (this.step === 'name') {
      if (value.length < 2) return { ...this.prompt(), error: 'Укажите имя минимум из двух символов.' };
      this.data.name = value.slice(0, 80); this.advance('name', 'contact');
    } else if (this.step === 'contact') {
      const phone = value.replace(/\D/g, ''), email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
      const russianPhone = phone.length === 11 && ['7', '8'].includes(phone[0]);
      if (!(russianPhone || email)) return { ...this.prompt(), error: 'Нужен российский телефон из 11 цифр или корректный email.' };
      this.data.contact = value; this.advance('contact', 'category');
    } else if (this.step === 'category') {
      if (!categories.includes(value)) return { ...this.prompt(), error: 'Выберите один из вариантов.' };
      this.data.category = value; this.advance('category', 'description');
    } else if (this.step === 'description') {
      if (value.length < 20) return { ...this.prompt(), error: 'Добавьте немного деталей — минимум 20 символов.' };
      this.data.description = value.slice(0, 1000); this.advance('description', 'budget');
    } else if (this.step === 'budget') {
      if (!budgets.includes(value)) return { ...this.prompt(), error: 'Выберите диапазон бюджета.' };
      this.data.budget = value; this.advance('budget', 'urgency');
    } else if (this.step === 'urgency') {
      if (!urgencyOptions.includes(value)) return { ...this.prompt(), error: 'Выберите вариант срока.' };
      this.data.urgency = value; this.advance('urgency', 'confirm');
    } else if (this.step === 'confirm') {
      if (value === 'Изменить описание') { this.step = 'description'; return this.prompt(); }
      if (value !== 'Отправить заявку') return { ...this.prompt(), error: 'Подтвердите отправку или измените данные.' };
      this.data.id = `RQ-${this.idFactory()}`;
      this.data.createdAt = this.now().toISOString();
      this.finished = true;
      this.events.push({ type: 'lead_created', priority: leadPriority(this.data.urgency).code, route: routeLead(this.data.category).team, at: this.data.createdAt });
      this.step = 'complete';
    }
    return this.prompt();
  }
  lead() { return this.finished ? buildLead(this.data) : null; }
  notification() {
    const lead = this.lead();
    if (!lead) return null;
    return { title: `${lead.priority.code === 'high' ? 'Срочная' : 'Новая'} заявка ${lead.id}`, priority: lead.priority.code, recipient: lead.route.channel, body: `${lead.client.name} · ${lead.request.category}\n${lead.request.description}\n${lead.client.contact}`, lead };
  }
}
