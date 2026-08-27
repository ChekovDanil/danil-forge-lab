import { clearState, loadState, saveState } from "./idb.js";

const $ = (id) => document.getElementById(id);
const nodes = {
  list: $("visitList"), title: $("titleInput"), body: $("bodyInput"), site: $("siteInput"), tags: $("tagsInput"), status: $("statusInput"),
  siteLabel: $("siteLabel"), version: $("versionLabel"), state: $("recordState"), editor: $("editor"), conflict: $("conflictPanel"),
  local: $("localVersion"), remote: $("remoteVersion"), merge: $("mergeInput"), connection: $("connectionButton"), connectionLabel: $("connectionLabel"),
  syncButton: $("syncButton"), syncTitle: $("syncTitle"), syncDetail: $("syncDetail"), syncIcon: $("syncIcon"), toast: $("toast")
};
let state = { deviceId: crypto.randomUUID(), online: navigator.onLine, records: [], queue: [], lastSyncAt: null };
let selectedId = "visit-north";
let saveTimer;

const clone = (value) => structuredClone(value);
const now = () => new Date().toISOString();
const record = () => state.records.find((item) => item.note.id === selectedId) || state.records[0];
const labelState = (value) => value === "conflict" ? "Есть конфликт" : value === "pending" ? "Ждёт синхронизации" : "Сохранено";

function showToast(message) {
  nodes.toast.textContent = message;
  nodes.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => nodes.toast.classList.remove("show"), 2600);
}

function makeDevice(remote) {
  return { deviceId: crypto.randomUUID(), online: navigator.onLine, records: remote.map((note) => ({ note, baseVersion: note.version, syncState: "synced", conflict: null })), queue: [], lastSyncAt: null };
}

function render() {
  if (!state.records.length) return;
  const current = record();
  if (!current) return;
  selectedId = current.note.id;
  nodes.list.innerHTML = state.records.map((item) => `<button class="visit-card ${item.note.id === selectedId ? "active" : ""}" data-id="${item.note.id}" type="button"><div class="visit-card-top"><strong>${escapeHtml(item.note.title)}</strong><span class="state-dot ${item.syncState}"></span></div><p>${escapeHtml(item.note.site)}</p></button>`).join("");
  nodes.title.value = current.note.title;
  nodes.body.value = current.note.body;
  nodes.site.value = current.note.site;
  nodes.tags.value = (current.note.tags || []).join(", ");
  nodes.status.value = current.note.status;
  nodes.siteLabel.textContent = current.note.site || "Без участка";
  nodes.version.textContent = `Версия ${current.note.version || "локальная"} · ${current.note.updatedBy || "Вы"}`;
  nodes.state.textContent = labelState(current.syncState);
  const conflict = current.syncState === "conflict" && current.conflict;
  nodes.conflict.hidden = !conflict;
  nodes.editor.classList.toggle("locked", Boolean(conflict));
  if (conflict) {
    nodes.local.textContent = conflict.local.body;
    nodes.remote.textContent = conflict.remote.body;
    nodes.merge.value = `${conflict.remote.body}\n\n— Дополнение с устройства —\n${conflict.local.body}`;
  }
  nodes.connection.classList.toggle("offline", !state.online);
  nodes.connectionLabel.textContent = state.online ? "В сети" : "Без сети";
  const conflicts = state.records.filter((item) => item.syncState === "conflict").length;
  if (conflicts) {
    nodes.syncIcon.textContent = "!"; nodes.syncTitle.textContent = "Нужно сравнить версии"; nodes.syncDetail.textContent = `${conflicts} запись · обе версии сохранены`;
  } else if (state.queue.length) {
    nodes.syncIcon.textContent = "↑"; nodes.syncTitle.textContent = state.online ? "Есть несинхронизированные изменения" : "Изменения сохранены на устройстве"; nodes.syncDetail.textContent = `${state.queue.length} запись в очереди`;
  } else {
    nodes.syncIcon.textContent = "✓"; nodes.syncTitle.textContent = "Все изменения сохранены"; nodes.syncDetail.textContent = state.online ? "Локально и в офисе" : "Локально · сеть недоступна";
  }
  nodes.syncButton.textContent = state.online ? "Синхронизировать" : "Вернуться в сеть";
}

function escapeHtml(value) { const div = document.createElement("div"); div.textContent = value ?? ""; return div.innerHTML; }
async function persist() { await saveState(state); }

function editCurrent() {
  const current = record();
  if (!current || current.syncState === "conflict") return;
  current.note = { ...current.note, title: nodes.title.value.trim(), body: nodes.body.value.trim(), site: nodes.site.value.trim(), tags: [...new Set(nodes.tags.value.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 8), status: nodes.status.value, updatedAt: now(), updatedBy: "Вы" };
  current.syncState = "pending";
  let op = state.queue.find((item) => item.noteId === current.note.id);
  if (!op) { op = { id: crypto.randomUUID(), noteId: current.note.id, type: "upsert", baseVersion: current.baseVersion, createdAt: now() }; state.queue.push(op); }
  op.patch = Object.fromEntries(["title", "body", "site", "tags", "status"].map((key) => [key, clone(current.note[key])]));
  op.updatedAt = now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => { await persist(); render(); }, 180);
  nodes.state.textContent = "Сохранение…";
}

async function sync() {
  if (!state.online) { state.online = true; await persist(); render(); showToast("Демо-соединение восстановлено"); }
  if (!state.queue.length) { showToast("Новых изменений нет"); return; }
  nodes.syncButton.disabled = true;
  try {
    const response = await fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: state.deviceId, operations: state.queue }) });
    if (!response.ok) throw new Error("sync_failed");
    const result = await response.json();
    const accepted = new Set(result.accepted.map((item) => item.operationId));
    const conflicted = new Set(result.conflicts.map((item) => item.operationId));
    for (const item of result.accepted) { const local = state.records.find((x) => x.note.id === item.note.id); local.note = item.note; local.baseVersion = item.note.version; local.syncState = "synced"; local.conflict = null; }
    for (const item of result.conflicts) { const local = state.records.find((x) => x.note.id === item.noteId); local.syncState = "conflict"; local.conflict = { local: clone(local.note), remote: item.remote, operationId: item.operationId, detectedAt: now() }; }
    state.queue = state.queue.filter((op) => !accepted.has(op.id) && !conflicted.has(op.id));
    state.lastSyncAt = now(); await persist(); render();
    showToast(result.conflicts.length ? "Обнаружены две версии. Выберите итоговую." : "Изменения синхронизированы");
  } catch { state.online = false; await persist(); render(); showToast("Сети нет. Изменения остаются на устройстве."); }
  finally { nodes.syncButton.disabled = false; }
}

async function resolve(strategy) {
  const current = record(); const conflict = current?.conflict; if (!conflict) return;
  if (strategy === "remote") { current.note = conflict.remote; current.baseVersion = conflict.remote.version; current.syncState = "synced"; current.conflict = null; }
  else {
    const local = conflict.local; const remote = conflict.remote;
    current.note = strategy === "local" ? { ...local, version: remote.version } : { ...remote, title: local.title || remote.title, body: nodes.merge.value.trim(), site: local.site || remote.site, tags: [...new Set([...(remote.tags || []), ...(local.tags || [])])], status: local.status || remote.status, updatedAt: now(), updatedBy: "Вы" };
    current.baseVersion = remote.version; current.syncState = "pending"; current.conflict = null;
    state.queue.push({ id: crypto.randomUUID(), type: "upsert", noteId: current.note.id, baseVersion: remote.version, patch: Object.fromEntries(["title", "body", "site", "tags", "status"].map((key) => [key, clone(current.note[key])])), createdAt: now(), updatedAt: now(), resolution: strategy });
  }
  await persist(); render(); if (strategy !== "remote") await sync(); else showToast("Офисная версия принята");
}

async function initialize() {
  const saved = await loadState();
  if (saved) state = saved;
  else { const response = await fetch("/api/remote"); state = makeDevice((await response.json()).notes); await persist(); }
  state.online = navigator.onLine && state.online !== false;
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/service-worker.js").catch(() => {});
}

nodes.list.addEventListener("click", (event) => { const button = event.target.closest("[data-id]"); if (!button) return; selectedId = button.dataset.id; render(); });
[nodes.title,nodes.body,nodes.site,nodes.tags].forEach((node) => node.addEventListener("input", editCurrent)); nodes.status.addEventListener("change", editCurrent);
nodes.connection.addEventListener("click", async () => { state.online = !state.online; await persist(); render(); showToast(state.online ? "Демо-соединение включено" : "Демо: соединение отключено"); });
nodes.syncButton.addEventListener("click", sync);
$("collaboratorButton").addEventListener("click", async () => { await fetch("/api/demo/collaborator-edit", { method: "POST" }); showToast("В офисе изменили эту запись"); });
$("resetButton").addEventListener("click", async () => { await fetch("/api/reset", { method: "POST" }); await clearState(); location.reload(); });
$("newButton").addEventListener("click", async () => { const id = `visit-${Date.now()}`; const note = { id, title: "Новый осмотр", body: "Начните запись. Она сохранится даже без сети.", site: "Новый участок", tags: [], status: "draft", version: 0, updatedAt: now(), updatedBy: "Вы" }; state.records.unshift({ note, baseVersion: 0, syncState: "pending", conflict: null }); state.queue.push({ id: crypto.randomUUID(), type: "upsert", noteId: id, baseVersion: 0, patch: { title: note.title, body: note.body, site: note.site, tags: [], status: note.status }, createdAt: now(), updatedAt: now() }); selectedId = id; await persist(); render(); });
document.querySelectorAll("[data-resolve]").forEach((button) => button.addEventListener("click", () => resolve(button.dataset.resolve)));
window.addEventListener("online", () => { state.online = true; persist().then(render); }); window.addEventListener("offline", () => { state.online = false; persist().then(render); });
initialize();
