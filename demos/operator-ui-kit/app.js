const densityButton = document.querySelector('#densityButton');
const toast = document.querySelector('#toast');
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
}

densityButton.addEventListener('click', () => {
  const compact = document.body.classList.toggle('compact-density');
  densityButton.setAttribute('aria-pressed', String(compact));
  densityButton.textContent = compact ? 'Свободнее' : 'Плотнее';
});

document.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
  document.querySelectorAll('.chip').forEach((item) => item.classList.remove('selected'));
  chip.classList.add('selected');
  const messages = { all: 'Показаны все активные записи.', mine: 'Показаны действия, которые зависят от вас.', risk: 'Показаны задачи с проблемами и высоким приоритетом.' };
  document.querySelector('#filterNote').textContent = messages[chip.dataset.filter];
}));

document.querySelector('.open-decision').addEventListener('click', () => document.querySelector('#decisionNote').scrollIntoView({ behavior: 'smooth', block: 'center' }));
document.querySelector('#approveButton').addEventListener('click', () => showToast('Решение сохранено в демо.'));
document.querySelector('#noticeButton').addEventListener('click', () => showToast('3 обновления в автоматических задачах.'));
