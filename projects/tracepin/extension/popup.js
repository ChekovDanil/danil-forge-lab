import { searchClips } from "./clip-core.js";

let clips = [];
const list = document.querySelector('#pinList'), empty = document.querySelector('#empty'), count = document.querySelector('#count'), search = document.querySelector('#search'), toast = document.querySelector('#toast'), pickerStatus = document.querySelector('#pickerStatus');

const send = async (message) => {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || 'request_failed');
  return response;
};
const node = (tag, text, className) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (className) el.className = className; return el; };
const notify = (text) => { toast.textContent = text; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 1800); };

function render() {
  const visible = searchClips(clips, search.value);
  list.replaceChildren(); count.textContent = clips.length; empty.hidden = visible.length > 0;
  visible.slice(0, 6).forEach((pin) => {
    const row = node('article', undefined, 'pin');
    row.append(node('i', undefined, pin.priority));
    const content = node('div', undefined, 'pin-content');
    content.append(node('span', `${pin.type} · ${new URL(pin.url).hostname}`), node('b', pin.quote), node('small', pin.tags.map((tag) => `#${tag}`).join(' ') || 'без тегов'));
    const remove = node('button', '×'); remove.title = 'Удалить'; remove.addEventListener('click', async () => { const response = await send({ type: 'REMOVE_PIN', id: pin.id }); clips = response.clips; render(); notify('Правка удалена'); });
    row.append(content, remove); list.append(row);
  });
}

async function load() { clips = (await send({ type: 'GET_STATE' })).clips; render(); }
document.querySelector('#startPicker').addEventListener('click', async () => { try { await send({ type: 'START_PICKER' }); window.close(); } catch (error) { pickerStatus.textContent = error.message === 'page_unavailable' ? 'Эта страница недоступна для отметки.' : 'Не удалось запустить выбор.'; } });
document.querySelector('#openLibrary').addEventListener('click', () => chrome.runtime.openOptionsPage());
document.querySelector('#clearBadge').addEventListener('click', async () => { await chrome.action.setBadgeText({ text: '' }); notify('Индикатор очищен'); });
search.addEventListener('input', render);
load().catch((error) => notify(error.message));
