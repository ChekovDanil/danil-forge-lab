export const categoryPolicies = {
  payment: { label: 'Оплата', team: 'Биллинг', assignee: 'Марина', response: 'Проверю платёж и вернусь с результатом. Пришлите, пожалуйста, последние четыре цифры операции.' },
  technical: { label: 'Технический вопрос', team: 'Техподдержка', assignee: 'Илья', response: 'Проверю работу сервиса. Напишите, на каком шаге возникла ошибка и что отображается на экране.' },
  access: { label: 'Доступ', team: 'Аккаунты', assignee: 'Олег', response: 'Помогу восстановить доступ. Уточните почту аккаунта, пароль присылать не нужно.' },
  feedback: { label: 'Предложение', team: 'Продукт', assignee: 'Анна', response: 'Спасибо, зафиксировал предложение. Передам его продуктовой команде вместе с контекстом.' },
  other: { label: 'Другой вопрос', team: 'Первая линия', assignee: 'Дежурный', response: 'Принял обращение. Уточню детали и направлю вопрос подходящему специалисту.' }
};

export const statusLabels = {
  new: 'Новое',
  triaged: 'Распределено',
  in_progress: 'В работе',
  waiting_customer: 'Ждём клиента',
  escalated: 'Нужен человек',
  resolved: 'Решено',
  closed: 'Закрыто'
};

const transitions = {
  new: ['triaged', 'closed'],
  triaged: ['in_progress', 'escalated', 'closed'],
  in_progress: ['waiting_customer', 'escalated', 'resolved'],
  waiting_customer: ['in_progress', 'escalated', 'resolved'],
  escalated: ['in_progress', 'waiting_customer', 'resolved'],
  resolved: ['in_progress', 'closed'],
  closed: []
};

const clean = (value, limit = 2000) => String(value ?? '').trim().slice(0, limit);

export function assessPriority({ impact = 'single', blocked = false, customerTier = 'standard' } = {}) {
  if (blocked && impact === 'many') return { code: 'critical', label: 'Критический', minutes: 15 };
  if (blocked || impact === 'many' || customerTier === 'priority') return { code: 'high', label: 'Высокий', minutes: 30 };
  return { code: 'normal', label: 'Обычный', minutes: 240 };
}

export function routeTicket(category) {
  const policy = categoryPolicies[category] ?? categoryPolicies.other;
  return { team: policy.team, assignee: policy.assignee };
}

export function suggestReply(ticket) {
  const policy = categoryPolicies[ticket.category] ?? categoryPolicies.other;
  const greeting = ticket.customer.name ? `${ticket.customer.name}, добрый день.` : 'Добрый день.';
  return `${greeting} ${policy.response}`;
}

export function createTelegramBotApiAdapter({ token = '', fetchImpl = globalThis.fetch, apiBase = 'https://api.telegram.org' } = {}) {
  const normalized = clean(token, 300);
  const configured = /^\d+:[A-Za-z0-9_-]{20,}$/.test(normalized);
  return {
    configured,
    async sendMessage(chatId, text) {
      if (!configured) return { ok: false, skipped: true, reason: 'not_configured' };
      if (!/^[-]?\d+$/.test(String(chatId))) throw new Error('chatId must be numeric');
      const response = await fetchImpl(`${apiBase}/bot${normalized}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: String(chatId), text: clean(text, 4000) })
      });
      if (!response.ok) throw new Error(`Telegram Bot API returned ${response.status}`);
      return response.json();
    }
  };
}

export class SupportDesk {
  constructor({ now = () => new Date(), idFactory = () => crypto.randomUUID().slice(0, 6).toUpperCase() } = {}) {
    this.now = now;
    this.idFactory = idFactory;
    this.tickets = [];
  }

  intake(input) {
    const name = clean(input.name, 80);
    const contact = clean(input.contact, 160);
    const message = clean(input.message, 3000);
    const category = categoryPolicies[input.category] ? input.category : 'other';
    if (name.length < 2) throw new Error('Укажите имя минимум из двух символов');
    if (!contact) throw new Error('Нужен контакт для ответа');
    if (message.length < 12) throw new Error('Опишите вопрос подробнее');

    const createdAt = this.now();
    const priority = assessPriority(input);
    const route = routeTicket(category);
    const ticket = {
      id: `SUP-${this.idFactory()}`,
      customer: { name, contact },
      category,
      message,
      source: clean(input.source, 60) || 'web-preview',
      priority,
      sla: {
        minutes: priority.minutes,
        dueAt: new Date(createdAt.getTime() + priority.minutes * 60_000).toISOString(),
        breached: false
      },
      route,
      assignee: route.assignee,
      status: 'triaged',
      humanRequired: false,
      escalationReason: '',
      suggestedReply: '',
      history: [
        { status: 'new', at: createdAt.toISOString(), actor: 'system', note: 'Обращение принято' },
        { status: 'triaged', at: createdAt.toISOString(), actor: 'router', note: `${route.team} · ${route.assignee}` }
      ]
    };
    ticket.suggestedReply = suggestReply(ticket);
    this.tickets.unshift(ticket);
    return structuredClone(ticket);
  }

  get(id) {
    const ticket = this.tickets.find((item) => item.id === id);
    return ticket ? structuredClone(ticket) : null;
  }

  list() {
    return this.tickets.map((ticket) => structuredClone(ticket));
  }

  transition(id, status, { actor = 'operator', note = '' } = {}) {
    const ticket = this.tickets.find((item) => item.id === id);
    if (!ticket) throw new Error('Обращение не найдено');
    if (!transitions[ticket.status]?.includes(status)) throw new Error(`Переход ${ticket.status} → ${status} недоступен`);
    ticket.status = status;
    if (status === 'in_progress') {
      ticket.humanRequired = false;
      ticket.escalationReason = '';
    }
    if (status === 'resolved' || status === 'closed') ticket.sla.breached = false;
    ticket.history.push({ status, at: this.now().toISOString(), actor: clean(actor, 80), note: clean(note, 500) });
    return structuredClone(ticket);
  }

  escalate(id, reason, actor = 'agent') {
    const ticket = this.tickets.find((item) => item.id === id);
    if (!ticket) throw new Error('Обращение не найдено');
    const normalizedReason = clean(reason, 500);
    if (normalizedReason.length < 5) throw new Error('Укажите причину эскалации');
    if (!transitions[ticket.status]?.includes('escalated')) throw new Error('Эскалация недоступна в текущем статусе');
    ticket.status = 'escalated';
    ticket.humanRequired = true;
    ticket.escalationReason = normalizedReason;
    ticket.assignee = ticket.route.assignee;
    ticket.history.push({ status: 'escalated', at: this.now().toISOString(), actor: clean(actor, 80), note: normalizedReason });
    return structuredClone(ticket);
  }

  checkSla(at = this.now()) {
    const changed = [];
    for (const ticket of this.tickets) {
      if (['resolved', 'closed'].includes(ticket.status) || ticket.sla.breached) continue;
      if (new Date(ticket.sla.dueAt).getTime() <= at.getTime()) {
        ticket.sla.breached = true;
        ticket.humanRequired = true;
        ticket.history.push({ status: ticket.status, at: at.toISOString(), actor: 'sla-monitor', note: 'SLA первого ответа нарушен' });
        changed.push(structuredClone(ticket));
      }
    }
    return changed;
  }
}
