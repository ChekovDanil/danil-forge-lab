export const FILTERS = Object.freeze(['all', 'new', 'priority', 'approved', 'escalated']);

const clone = (value) => structuredClone(value);

export class RequestQueue {
  constructor(items = []) {
    this.items = clone(items);
    this.events = [{ id: 'init', type: 'system', title: 'Очередь подготовлена', at: '09:10' }];
  }

  list(filter = 'all') {
    if (!FILTERS.includes(filter)) throw new Error('unknown_filter');
    const items = filter === 'all'
      ? this.items
      : filter === 'priority'
        ? this.items.filter((item) => item.priority === 'high' && !['approved', 'closed'].includes(item.status))
        : this.items.filter((item) => item.status === filter);
    return clone([...items].sort((a, b) => {
      const urgency = Number(b.priority === 'high') - Number(a.priority === 'high');
      return urgency || b.score - a.score;
    }));
  }

  get(id) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw new Error('request_not_found');
    return clone(item);
  }

  approve(id, at = 'сейчас') {
    const item = this.#findMutable(id);
    if (item.status === 'approved') return clone(item);
    if (item.status === 'closed') throw new Error('request_closed');
    item.status = 'approved';
    this.#record('approved', `Заявка «${item.title}» подтверждена`, at, item.id);
    return clone(item);
  }

  escalate(id, at = 'сейчас') {
    const item = this.#findMutable(id);
    if (item.status === 'approved' || item.status === 'closed') throw new Error('request_not_actionable');
    item.status = 'escalated';
    item.priority = 'high';
    this.#record('escalated', `Нужна ручная оценка: «${item.title}»`, at, item.id);
    return clone(item);
  }

  togglePriority(id, at = 'сейчас') {
    const item = this.#findMutable(id);
    item.priority = item.priority === 'high' ? 'normal' : 'high';
    this.#record('priority', `${item.priority === 'high' ? 'Высокий' : 'Обычный'} приоритет: «${item.title}»`, at, item.id);
    return clone(item);
  }

  summary() {
    return {
      total: this.items.length,
      new: this.items.filter((item) => item.status === 'new').length,
      priority: this.items.filter((item) => item.priority === 'high' && !['approved', 'closed'].includes(item.status)).length,
      approved: this.items.filter((item) => item.status === 'approved').length,
      escalated: this.items.filter((item) => item.status === 'escalated').length
    };
  }

  history() { return clone(this.events); }

  #findMutable(id) {
    const item = this.items.find((entry) => entry.id === id);
    if (!item) throw new Error('request_not_found');
    return item;
  }

  #record(type, title, at, requestId) {
    this.events.unshift({ id: `${type}-${this.events.length + 1}`, type, title, at, requestId });
  }
}

export const demoRequests = Object.freeze([
  {
    id: 'rq-104', source: 'Kwork', title: 'Исправить форму оплаты', client: 'Михаил', status: 'new', priority: 'high', score: 94,
    budget: '12 000 ₽', deadline: 'Сегодня · 18:00', category: 'Веб-разработка', age: '8 мин',
    brief: 'После обновления сайта форма отправляется, но подтверждение оплаты не появляется. Нужна диагностика и аккуратное исправление без переделки страницы.',
    proposal: 'Проверить сетевой запрос, обработчик ответа и состояние интерфейса. Сначала воспроизвести ошибку, затем внести локальную правку и показать результат на тестовой копии.',
    risk: 'Доступ к платёжному кабинету нельзя передавать в переписке. Для проверки достаточно тестового режима и журналов браузера.'
  },
  {
    id: 'rq-103', source: 'FL.ru', title: 'Telegram-бот для заявок', client: 'Студия Север', status: 'new', priority: 'normal', score: 88,
    budget: '25 000 ₽', deadline: '5 дней', category: 'Автоматизация', age: '21 мин',
    brief: 'Нужен бот, который задаёт семь вопросов, собирает контакт и отправляет менеджеру готовую карточку.',
    proposal: 'Собрать короткий сценарий, валидацию обязательных полей, журнал заявок и понятную передачу менеджеру. Перед стартом согласовать канал и формат уведомлений.',
    risk: 'Нужно уточнить, где хранить заявки и кто получает персональные данные.'
  },
  {
    id: 'rq-102', source: 'Profi.ru', title: 'Карточки для маркетплейса', client: 'Анна', status: 'new', priority: 'normal', score: 79,
    budget: '6 500 ₽', deadline: '2 дня', category: 'Графика', age: '46 мин',
    brief: 'Подготовить пять аккуратных карточек товара по готовым фото и характеристикам.',
    proposal: 'Сначала собрать одну ключевую карточку и согласовать визуальный язык, затем развернуть систему на остальные изображения.',
    risk: 'Низкий. Понадобятся исходные фотографии без сжатия и точные размеры площадки.'
  },
  {
    id: 'rq-101', source: 'Kwork', title: 'Адаптация лендинга', client: 'Виктор', status: 'approved', priority: 'normal', score: 91,
    budget: '9 000 ₽', deadline: '3 дня', category: 'Frontend', age: '1 ч',
    brief: 'Исправить мобильную версию: меню, таблицу тарифов и форму заявки.',
    proposal: 'Проверить основные ширины, исправить переполнение и размеры интерактивных элементов, затем пройти критические сценарии на телефоне.',
    risk: 'Низкий. Нужен репозиторий или архив текущей версии.'
  },
  {
    id: 'rq-100', source: 'Freelance.ru', title: 'Интеграция с закрытой CRM', client: 'Компания', status: 'escalated', priority: 'high', score: 72,
    budget: 'По оценке', deadline: 'Не указан', category: 'Интеграция', age: '2 ч',
    brief: 'Передавать обращения с сайта в корпоративную CRM с нестандартной авторизацией.',
    proposal: 'Сначала запросить документацию и тестовый контур. После проверки API отдельно оценить интеграцию и поддержку ошибок.',
    risk: 'Высокий. Нет документации, тестового доступа и описания ограничений API.'
  }
]);
