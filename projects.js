const projects = [
  ['reportkit','ReportKit','Данные','Проверка CSV, сопоставление колонок и безопасный экспорт.','projects/reportkit'],
  ['stockroom','Stockroom','Админ-панель','Каталог, массовые операции, импорт и отмена изменений.','projects/stockroom'],
  ['clientspace','Clientspace','Кабинет клиента','Этапы проекта, файлы, правки и согласование результата.','projects/clientspace'],
  ['leadline','Leadline','CRM','Компактная воронка, следующая активность и причины отказа.','projects/leadline'],
  ['telegram-mini-queue','Queue','Mini App-style UI','Очередь обращений, подтверждение и эскалация оператору.','demos/telegram-mini-queue'],
  ['telegram-support','Lineup Support','Поддержка','Приём обращений, приоритеты и передача сложных случаев.','demos/telegram-support'],
  ['telegram-intake-bot','Relay','Автоматизация','Проверка заявки, приоритет, SLA и маршрут исполнения.','projects/relay'],
  ['public-watch','Public Watch','Демо мониторинга','Локальный сценарий сравнения разрешённых публичных данных.','demos/public-watch'],
  ['operator-ui-kit','Operator UI Kit','UI-система','Рабочие компоненты и состояния для плотных интерфейсов.','demos/operator-ui-kit'],
  ['storefront-lab','Storefront Lab','Интернет-магазин','Каталог, быстрый просмотр, корзина и локальное оформление заказа.','projects/storefront-lab'],
  ['sheetflow','SheetFlow','Excel и сверка','Сопоставление двух таблиц, расхождения и безопасный CSV-экспорт.','projects/sheetflow'],
  ['docforge','DocForge','Документы','Коммерческое предложение, счёт и акт из одной формы.','projects/docforge'],
  ['catalog-watch','Catalog Watch','Контроль каталога','Сравнение локальных снимков каталога, изменения и безопасный CSV-отчёт.','projects/catalog-watch'],
  ['content-patch','Content Patch','Поддержка сайта','Проверка страниц, план исправлений, резервная точка и откат.','projects/content-patch'],
  ['northern-relay-concept','Northern Relay Station','AI-assisted concept','Архитектурный поиск, материалы, ключевые кадры и интерьер в едином арт-дирекшене.','demos/northern-relay-concept']
];

const repository = 'https://github.com/ChekovDanil/danil-forge-lab/tree/main/';
const sources = [
  ['reportkit','ReportKit','CSV и отчёты'],
  ['relay','Relay','Маршрутизация заявок'],
  ['groundlog','Groundlog','Offline-first PWA'],
  ['tracepin','TracePin','Расширение браузера'],
  ['batch-studio','Batch Studio','Пакетная обработка'],
  ['release-dock','Release Dock','Контроль релизов'],
  ['signal-bot','Signal Bot','Мониторинг и уведомления']
  ,['fielddesk','FieldDesk','CRM для выездной команды']
  ,['booking-desk','Booking Desk','Запись и расписание']
  ,['clientspace','Clientspace','Кабинет клиента']
  ,['stockroom','Stockroom','Админка каталога']
  ,['leadline','Leadline','CRM продаж']
  ,['access-hub','Access Hub','Авторизация и роли']
  ,['syncbridge','SyncBridge','API-синхронизация']
  ,['knowledge-desk','Knowledge Desk','База знаний']
  ,['storefront-lab','Storefront Lab','Интернет-витрина']
  ,['sheetflow','SheetFlow','Сверка таблиц']
  ,['docforge','DocForge','Генерация документов']
  ,['catalog-watch','Catalog Watch','Контроль изменений']
  ,['content-patch','Content Patch','Поддержка сайта']
];

document.querySelector('#project-grid').innerHTML = projects.map((project,index) => {
  const [id,title,type,text,source] = project;
  const sourceLink = `<a href="${repository}${source}">Исходники <span>→</span></a>`;
  return `<article class="project">
    <a class="preview" href="./demos/${id}/index.html" aria-label="Открыть ${title}">
      <img src="./thumbnails/${id}.png" alt="Превью ${title}" loading="lazy" width="1265" height="768">
      <span class="open-mark">↗</span>
    </a>
    <div class="project-meta"><span>${String(index+1).padStart(2,'0')}</span><span>${type}</span></div>
    <h2>${title}</h2><p>${text}</p>
    <div class="project-actions"><a href="./demos/${id}/index.html">Открыть демо <span>↗</span></a>${sourceLink}</div>
  </article>`;
}).join('');

document.querySelector('#source-grid').innerHTML = sources.map(([id,title,type],index) => `
  <a class="source-card" href="${repository}projects/${id}">
    <span>${String(index+1).padStart(2,'0')} · ${type}</span>
    <strong>${title}</strong><i>↗</i>
  </a>`).join('');

