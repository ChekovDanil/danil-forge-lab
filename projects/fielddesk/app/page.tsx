'use client';

import { FormEvent, useMemo, useState } from 'react';
import { createJobId, matchesFilter, needsAttention, nextStatus, type Filter, type JobStatus, type SlaState } from './domain';

type JobEvent = {
  title: string;
  meta: string;
};

type Job = {
  id: string;
  title: string;
  client: string;
  phone: string;
  address: string;
  status: JobStatus;
  priority: 'Обычный' | 'Высокий';
  due: string;
  dueLabel: string;
  sla: SlaState;
  master: string;
  note: string;
  events: JobEvent[];
};

const masters = ['Илья Соколов', 'Антон Ветров', 'Мария Громова'];

const initialJobs: Job[] = [
  {
    id: 'FD-241',
    title: 'Холодильная витрина не держит температуру',
    client: 'Кофейня «Смена»',
    phone: '+7 000 000-00-01',
    address: 'Красный проспект, 28',
    status: 'Новая',
    priority: 'Высокий',
    due: '24 мин',
    dueLabel: 'до реакции',
    sla: 'critical',
    master: '',
    note: 'Температура поднялась до +11 °C. Продукты перенесли в резервную камеру.',
    events: [
      { title: 'Заявка принята', meta: 'Сегодня, 10:06 · сайт' },
      { title: 'Клиент приложил видео', meta: 'Сегодня, 10:09 · 18 секунд' },
    ],
  },
  {
    id: 'FD-238',
    title: 'Профилактика кофемашины перед выходными',
    client: 'Buro Coffee',
    phone: '+7 000 000-00-02',
    address: 'ул. Ленина, 12',
    status: 'Назначена',
    priority: 'Обычный',
    due: '13:30',
    dueLabel: 'визит сегодня',
    sla: 'normal',
    master: 'Илья Соколов',
    note: 'Плановое обслуживание. На месте будет администратор Алина.',
    events: [
      { title: 'Назначен Илья Соколов', meta: 'Сегодня, 09:42 · диспетчер' },
      { title: 'Время подтверждено клиентом', meta: 'Сегодня, 09:48 · чат' },
    ],
  },
  {
    id: 'FD-236',
    title: 'Протечка в контуре охлаждения',
    client: 'Ресторан «Соль»',
    phone: '+7 000 000-00-03',
    address: 'ул. Советская, 19',
    status: 'В работе',
    priority: 'Высокий',
    due: '52 мин',
    dueLabel: 'до нарушения SLA',
    sla: 'risk',
    master: 'Антон Ветров',
    note: 'Мастер на объекте. Нужна замена соединения, деталь есть в автомобиле.',
    events: [
      { title: 'Мастер прибыл на объект', meta: 'Сегодня, 09:31 · геопозиция' },
      { title: 'Найдена причина протечки', meta: 'Сегодня, 09:46 · Антон Ветров' },
    ],
  },
  {
    id: 'FD-231',
    title: 'Согласовать повторный выезд после диагностики',
    client: 'Пекарня № 7',
    phone: '+7 000 000-00-04',
    address: 'ул. Фрунзе, 86',
    status: 'Ожидает',
    priority: 'Обычный',
    due: '15:00',
    dueLabel: 'ответ клиента',
    sla: 'normal',
    master: 'Илья Соколов',
    note: 'Смета отправлена. Повторный визит займёт около 40 минут.',
    events: [
      { title: 'Диагностика завершена', meta: 'Вчера, 17:22 · Илья Соколов' },
      { title: 'Смета отправлена', meta: 'Сегодня, 08:17 · email' },
    ],
  },
  {
    id: 'FD-229',
    title: 'Замена уплотнителя дверцы морозильной камеры',
    client: 'Гастромаркет «Цех»',
    phone: '+7 000 000-00-05',
    address: 'ул. Депутатская, 46',
    status: 'Назначена',
    priority: 'Обычный',
    due: '16:20',
    dueLabel: 'визит сегодня',
    sla: 'normal',
    master: 'Мария Громова',
    note: 'Запчасть получена со склада. Вход через служебную парковку.',
    events: [
      { title: 'Запчасть зарезервирована', meta: 'Сегодня, 08:12 · склад' },
      { title: 'Назначена Мария Громова', meta: 'Сегодня, 08:16 · диспетчер' },
    ],
  },
];

const statusAction: Record<JobStatus, string> = {
  Новая: 'Взять в работу',
  Назначена: 'Начать работу',
  'В работе': 'Завершить',
  Ожидает: 'Вернуть в работу',
  Завершена: 'Работа завершена',
};

export default function FieldDesk() {
  const [jobs, setJobs] = useState(initialJobs);
  const [filter, setFilter] = useState<Filter>('Все');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(initialJobs[0].id);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [commentOpen, setCommentOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState('');

  const selected = jobs.find((job) => job.id === selectedId) ?? jobs[0];
  const attentionCount = jobs.filter(needsAttention).length;
  const activeCount = jobs.filter((job) => ['Назначена', 'В работе', 'Ожидает'].includes(job.status)).length;
  const unassignedCount = jobs.filter((job) => !job.master && job.status !== 'Завершена').length;

  const visibleJobs = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru');
    return jobs.filter((job) => {
      const filterMatch = matchesFilter(job, filter);
      const searchMatch = !normalized || [job.id, job.title, job.client, job.address].join(' ').toLocaleLowerCase('ru').includes(normalized);
      return filterMatch && searchMatch;
    });
  }, [filter, jobs, query]);

  function flash(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 2600);
  }

  function updateSelected(change: (job: Job) => Job) {
    setJobs((current) => current.map((job) => (job.id === selected.id ? change(job) : job)));
  }

  function openJob(id: string) {
    setSelectedId(id);
    setDetailsOpen(true);
    setCommentOpen(false);
  }

  function assignMaster(master: string) {
    if (!master) return;
    updateSelected((job) => ({
      ...job,
      master,
      status: job.status === 'Новая' ? 'Назначена' : job.status,
      events: [{ title: `Назначен ${master}`, meta: 'Только что · диспетчер' }, ...job.events],
    }));
    flash('Исполнитель назначен');
  }

  function advanceJob() {
    if (selected.status === 'Завершена') return;
    if (!selected.master) {
      assignMaster(masters[0]);
      return;
    }
    const status = nextStatus(selected.status);
    updateSelected((job) => ({
      ...job,
      status,
      sla: status === 'Завершена' ? 'normal' : job.sla,
      events: [{ title: status === 'Завершена' ? 'Работа завершена' : `Статус: ${status}`, meta: 'Только что · диспетчер' }, ...job.events],
    }));
    flash(status === 'Завершена' ? 'Заявка завершена' : 'Статус обновлён');
  }

  function addComment(event: FormEvent) {
    event.preventDefault();
    const value = comment.trim();
    if (!value) return;
    updateSelected((job) => ({
      ...job,
      events: [{ title: value, meta: 'Только что · комментарий диспетчера' }, ...job.events],
    }));
    setComment('');
    setCommentOpen(false);
    flash('Комментарий добавлен');
  }

  function createJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const id = createJobId(jobs.length);
    const job: Job = {
      id,
      title: String(data.get('title') || 'Новая сервисная заявка'),
      client: String(data.get('client') || 'Новый клиент'),
      phone: String(data.get('phone') || 'Не указан'),
      address: String(data.get('address') || 'Адрес уточняется'),
      status: 'Новая',
      priority: data.get('priority') === 'Высокий' ? 'Высокий' : 'Обычный',
      due: data.get('priority') === 'Высокий' ? '30 мин' : '2 часа',
      dueLabel: 'до реакции',
      sla: data.get('priority') === 'Высокий' ? 'risk' : 'normal',
      master: '',
      note: String(data.get('note') || 'Описание уточняется у клиента.'),
      events: [{ title: 'Заявка создана диспетчером', meta: 'Только что · вручную' }],
    };
    setJobs((current) => [job, ...current]);
    setSelectedId(id);
    setCreateOpen(false);
    setDetailsOpen(true);
    setFilter('Все');
    flash('Новая заявка создана');
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">FD</span><div><b>FieldDesk</b><small>Сервисная команда</small></div></div>
        <nav className="side-nav" aria-label="Основная навигация">
          <button className="active"><span>01</span>Заявки<em>{jobs.filter((job) => job.status !== 'Завершена').length}</em></button>
          <button><span>02</span>Расписание</button>
          <button><span>03</span>Клиенты</button>
          <button><span>04</span>Отчёты</button>
        </nav>
        <section className="team-card">
          <p>Команда сегодня</p>
          <div className="avatar-stack"><i>ИС</i><i>АВ</i><i>МГ</i></div>
          <strong>3 мастера на линии</strong>
          <small>Ближайшее окно — 13:30</small>
        </section>
        <div className="sidebar-user"><i>ДК</i><div><b>Дарья Климова</b><small>Диспетчер</small></div><button aria-label="Настройки">•••</button></div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div><p>Четверг, 27 августа</p><h1>Сервисные заявки</h1></div>
          <div className="topbar-actions"><button className="quiet-button" onClick={() => flash('Отчёт подготовлен')}>Экспорт</button><button className="primary-button" onClick={() => setCreateOpen(true)}><span>+</span> Новая заявка</button></div>
        </header>

        <section className="summary" aria-label="Сводка">
          <article><span>Открыто</span><strong>{jobs.filter((job) => job.status !== 'Завершена').length}</strong><small>в очереди сейчас</small></article>
          <article className={attentionCount ? 'attention' : ''}><span>Требуют внимания</span><strong>{attentionCount}</strong><small>срок под риском</small></article>
          <article><span>В работе</span><strong>{activeCount}</strong><small>назначены команде</small></article>
          <article><span>Без мастера</span><strong>{unassignedCount}</strong><small>нужно назначить</small></article>
        </section>

        <div className="content-grid">
          <section className="queue-panel">
            <div className="queue-heading"><div><p>Очередь</p><h2>{visibleJobs.length} обращений</h2></div><label className="search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Номер, клиент или адрес" aria-label="Поиск заявок" /></label></div>
            <div className="filter-row" role="group" aria-label="Фильтр заявок">
              {(['Все', 'Новые', 'Активные', 'Проблемные'] as Filter[]).map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}{item === 'Проблемные' && attentionCount ? <em>{attentionCount}</em> : null}</button>)}
            </div>
            <div className="list-head"><span>Обращение</span><span>Срок</span><span>Исполнитель</span></div>
            <div className="job-list">
              {visibleJobs.map((job) => (
                <button key={job.id} className={`job-row ${selected.id === job.id ? 'selected' : ''}`} onClick={() => openJob(job.id)}>
                  <div className="job-main"><div className="job-meta"><span className={`status-dot ${job.sla}`} /> <b>{job.id}</b><span>{job.status}</span>{job.priority === 'Высокий' ? <em>Высокий</em> : null}</div><h3>{job.title}</h3><p>{job.client} · {job.address}</p></div>
                  <div className={`job-due ${job.sla}`}><strong>{job.due}</strong><small>{job.dueLabel}</small></div>
                  <div className="job-master">{job.master ? <><i>{job.master.split(' ').map((word) => word[0]).join('')}</i><span><b>{job.master}</b><small>{job.status}</small></span></> : <span className="unassigned">Не назначен</span>}<span className="row-arrow">›</span></div>
                </button>
              ))}
              {!visibleJobs.length ? <div className="empty-state"><span>0</span><h3>Заявки не найдены</h3><p>Измените поиск или верните общий список.</p><button onClick={() => { setQuery(''); setFilter('Все'); }}>Показать все</button></div> : null}
            </div>
          </section>

          <div className={`details-backdrop ${detailsOpen ? 'open' : ''}`} onClick={() => setDetailsOpen(false)} />
          <aside className={`details-panel ${detailsOpen ? 'open' : ''}`} aria-label="Карточка заявки">
            <div className="details-top"><span className="eyebrow">{selected.id}</span><button className="details-close" onClick={() => setDetailsOpen(false)} aria-label="Закрыть карточку">×</button></div>
            <div className="details-title"><div><span className={`detail-status ${selected.sla}`}>{selected.sla === 'critical' ? 'Критический срок' : selected.sla === 'risk' ? 'Срок под риском' : selected.status}</span><h2>{selected.title}</h2></div></div>
            <div className="client-line"><i>{selected.client.slice(0, 2).toUpperCase()}</i><div><b>{selected.client}</b><a href={`tel:${selected.phone.replace(/\s/g, '')}`}>{selected.phone}</a></div></div>
            <dl className="facts"><div><dt>Адрес</dt><dd>{selected.address}</dd></div><div><dt>Срок</dt><dd className={selected.sla}>{selected.due} · {selected.dueLabel}</dd></div><div><dt>Приоритет</dt><dd>{selected.priority}</dd></div><div><dt>Исполнитель</dt><dd>{selected.master || 'Не назначен'}</dd></div></dl>
            {!selected.master ? <label className="assign-field"><span>Назначить мастера</span><select value="" onChange={(event) => assignMaster(event.target.value)}><option value="" disabled>Выберите исполнителя</option>{masters.map((master) => <option key={master}>{master}</option>)}</select></label> : null}
            <section className="note"><span>Комментарий к заявке</span><p>{selected.note}</p></section>
            <section className="history"><div className="section-title"><h3>История</h3><button onClick={() => setCommentOpen((value) => !value)}>{commentOpen ? 'Отмена' : '+ Комментарий'}</button></div>{commentOpen ? <form className="comment-form" onSubmit={addComment}><textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Что важно зафиксировать?" autoFocus /><button>Добавить</button></form> : null}<ol>{selected.events.map((item, index) => <li key={`${item.title}-${index}`}><span /><div><b>{item.title}</b><small>{item.meta}</small></div></li>)}</ol></section>
            <div className="details-actions"><button className="secondary-button" onClick={() => flash('Карточка сохранена')}>Сохранить</button><button className="primary-button" onClick={advanceJob} disabled={selected.status === 'Завершена'}>{statusAction[selected.status]}</button></div>
          </aside>
        </div>
      </section>

      <nav className="mobile-nav" aria-label="Мобильная навигация"><button className="active"><span>01</span>Заявки</button><button><span>02</span>План</button><button onClick={() => setCreateOpen(true)} className="mobile-create">+</button><button><span>03</span>Клиенты</button><button><span>04</span>Ещё</button></nav>

      {createOpen ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) setCreateOpen(false); }}><form className="create-modal" onSubmit={createJob}><header><div><span>Новая запись</span><h2>Сервисная заявка</h2></div><button type="button" onClick={() => setCreateOpen(false)} aria-label="Закрыть">×</button></header><label><span>Проблема</span><input name="title" required placeholder="Коротко опишите обращение" /></label><div className="form-grid"><label><span>Клиент</span><input name="client" required placeholder="Компания или имя" /></label><label><span>Телефон</span><input name="phone" placeholder="+7 900 000-00-00" /></label></div><label><span>Адрес</span><input name="address" required placeholder="Куда выезжает мастер" /></label><label><span>Приоритет</span><select name="priority"><option>Обычный</option><option>Высокий</option></select></label><label><span>Комментарий</span><textarea name="note" placeholder="Что уже известно?" /></label><footer><button type="button" className="secondary-button" onClick={() => setCreateOpen(false)}>Отмена</button><button className="primary-button">Создать заявку</button></footer></form></div> : null}
      {notice ? <div className="toast" role="status"><span>✓</span>{notice}</div> : null}
    </main>
  );
}
