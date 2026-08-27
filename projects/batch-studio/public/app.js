const $ = (id) => document.getElementById(id);
const statusLabels = {
  ready: "Готов к запуску",
  running: "Выполняется",
  needs_attention: "Нужно решение",
  completed: "Готов",
  completed_with_warnings: "Готов с исключением",
  cancelled: "Отменён",
  queued: "В очереди",
  processing: "Обработка",
  succeeded: "Готово",
  failed: "Ошибка",
  excluded: "Исключён"
};

let state = { batches: [], recipes: [] };
let selectedBatchId = null;
let selectedJobId = null;
let pollBusy = false;
let toastTimer;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/gu, (symbol) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[symbol]));
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(bytes > 10240 ? 0 : 1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

function toast(message) {
  $("toast").textContent = message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" }, ...options });
  const type = response.headers.get("content-type") || "";
  const payload = type.includes("application/json") ? await response.json() : null;
  if (!response.ok) throw new Error(payload?.error || "request_failed");
  return payload;
}

function activeBatch() {
  return state.batches.find((batch) => batch.id === selectedBatchId) || state.batches[0] || null;
}

function jobPreview(batch, job) {
  if (job.status !== "succeeded") return "<span>" + escapeHtml(job.name.slice(0, 2).toUpperCase()) + "</span>";
  const variant = job.result.outputs.find((item) => item.variant === "thumb") || job.result.outputs[0];
  const source = "/api/batches/" + encodeURIComponent(batch.id) + "/jobs/" + encodeURIComponent(job.id) + "/outputs/" + encodeURIComponent(variant.variant);
  return "<img src='" + source + "' alt=''>";
}

function renderBatches() {
  $("batchCount").textContent = state.batches.length;
  $("batchList").innerHTML = state.batches.map((batch) => {
    const active = batch.id === activeBatch()?.id ? " active" : "";
    return "<button class='batch-button" + active + "' data-batch='" + escapeHtml(batch.id) + "'>" +
      "<b>" + escapeHtml(batch.name) + "</b>" +
      "<span><em>" + escapeHtml(statusLabels[batch.status] || batch.status) + "</em><em>" + batch.summary.done + "/" + batch.summary.total + "</em></span></button>";
  }).join("");
  document.querySelectorAll("[data-batch]").forEach((button) => button.addEventListener("click", () => {
    selectedBatchId = button.dataset.batch;
    selectedJobId = null;
    render();
  }));
}

function renderQueue(batch) {
  $("batchTitle").textContent = batch.name;
  $("batchStatus").textContent = statusLabels[batch.status] || batch.status;
  $("batchStatus").className = "batch-status " + (batch.status === "running" ? "running" : batch.status === "needs_attention" ? "attention" : "");
  $("progressBar").style.width = batch.summary.progress + "%";
  $("progressValue").textContent = batch.summary.done + " / " + batch.summary.total;
  $("progressMeta").textContent = batch.status === "running" ? "Worker продолжает в фоне" : statusLabels[batch.status] || batch.status;
  $("outputCount").textContent = batch.summary.outputFiles;
  $("outputSize").textContent = formatBytes(batch.summary.outputBytes);
  $("issueSummary").textContent = batch.summary.counts.failed ? batch.summary.counts.failed + " требует решения" : "без ошибок";

  $("jobList").innerHTML = batch.jobs.map((job) => {
    const selected = job.id === selectedJobId ? " active" : "";
    const operation = job.status === "succeeded" ? job.result.recipe.label : job.status === "processing" ? "Sharp worker" : job.status === "failed" ? "Входной gate" : "WebP · 3 размера";
    const detail = job.status === "succeeded" ? job.result.outputs.length + " outputs" : job.error ? job.error : formatBytes(job.inputBytes);
    return "<article class='job" + selected + "' data-job='" + escapeHtml(job.id) + "'>" +
      "<div class='job-main'><div class='job-thumb'>" + jobPreview(batch, job) + "</div><div class='job-copy'><b>" + escapeHtml(job.name) + "</b><span>" + escapeHtml(detail) + (job.duplicateOf ? " · duplicate #" + job.duplicateOf : "") + "</span></div></div>" +
      "<div class='job-operation'><b>" + escapeHtml(operation) + "</b><span>attempt " + job.attempts + "</span></div>" +
      "<span class='job-state " + escapeHtml(job.status) + "'>" + escapeHtml(statusLabels[job.status] || job.status) + "</span></article>";
  }).join("");

  document.querySelectorAll("[data-job]").forEach((row) => row.addEventListener("click", () => {
    selectedJobId = row.dataset.job;
    render();
  }));
}

function renderProof(batch) {
  const job = batch.jobs.find((item) => item.id === selectedJobId);
  if (!job) {
    $("proofPanel").innerHTML = "<div class='proof-empty'><span class='eyebrow'>PROOF SHEET</span><b>Выберите файл</b><p>Здесь появятся реальные выходные варианты, размеры и контрольные суммы.</p></div>";
    return;
  }
  const index = String(job.order).padStart(2, "0") + " / " + String(batch.jobs.length).padStart(2, "0");
  let preview = "<span>Результат ещё не готов</span>";
  if (job.status === "succeeded") {
    const output = job.result.outputs[0];
    const source = "/api/batches/" + encodeURIComponent(batch.id) + "/jobs/" + encodeURIComponent(job.id) + "/outputs/" + encodeURIComponent(output.variant);
    preview = "<img src='" + source + "' alt='" + escapeHtml(output.name) + "'>";
  }
  const sourceMeta = job.result?.source;
  const variants = job.result ? "<div class='variant-list'>" + job.result.outputs.map((output) =>
    "<div class='variant'><b>" + escapeHtml(output.variant) + "</b><span>" + output.width + " × " + output.height + " · " + formatBytes(output.bytes) + "</span><code>SHA " + escapeHtml(output.sha256.slice(0, 22)) + "…</code></div>"
  ).join("") + "</div>" : "";
  const issue = job.status === "failed" ? "<div class='issue-box'><b>Файл не прошёл проверку</b><p>" + escapeHtml(job.error) + ". Остальная очередь уже завершена.</p><div class='issue-actions'><button data-retry='" + escapeHtml(job.id) + "'>Исправить и повторить</button><button class='quiet' data-exclude='" + escapeHtml(job.id) + "'>Исключить</button></div></div>" : "";

  $("proofPanel").innerHTML = "<div class='proof-detail'>" +
    "<header class='proof-head'><div><span class='eyebrow'>PROOF SHEET</span><h3>" + escapeHtml(job.name) + "</h3></div><span class='proof-index'>" + index + "</span></header>" +
    "<div><div class='proof-preview'>" + preview + "</div><div class='proof-meta'>" +
      "<div><span>INPUT</span><b>" + (sourceMeta ? sourceMeta.width + " × " + sourceMeta.height : formatBytes(job.inputBytes)) + "</b></div>" +
      "<div><span>TYPE</span><b>" + escapeHtml(sourceMeta?.detectedMime || job.type) + "</b></div>" +
      "<div><span>RECIPE</span><b>" + escapeHtml(batch.recipe.label) + "</b></div>" +
      "<div><span>SOURCE SHA</span><b>" + escapeHtml(job.inputSha256.slice(0, 10)) + "…</b></div>" +
    "</div></div><div>" + variants + issue + "</div></div>";

  document.querySelector("[data-retry]")?.addEventListener("click", () => runAction("retry-demo", job.id));
  document.querySelector("[data-exclude]")?.addEventListener("click", () => runAction("exclude", job.id));
}

function renderCommands(batch) {
  const isRunning = batch.status === "running";
  const canStart = batch.status === "ready";
  $("startButton").disabled = !canStart;
  $("startButton").textContent = batch.startedAt ? "Продолжить" : "Запустить";
  $("pauseButton").disabled = !isRunning;
  $("cancelButton").disabled = !["ready", "running"].includes(batch.status);
  $("manifestLink").href = "/api/batches/" + encodeURIComponent(batch.id) + "/manifest";
  $("bundleLink").href = "/api/batches/" + encodeURIComponent(batch.id) + "/bundle";
  $("manifestLink").classList.toggle("disabled", batch.summary.done === 0);
  $("bundleLink").classList.toggle("disabled", batch.summary.outputFiles === 0);
}

function render() {
  renderBatches();
  const batch = activeBatch();
  if (!batch) return;
  selectedBatchId = batch.id;
  if (selectedJobId && !batch.jobs.some((job) => job.id === selectedJobId)) selectedJobId = null;
  renderQueue(batch);
  renderProof(batch);
  renderCommands(batch);
}

async function refresh() {
  if (pollBusy) return;
  pollBusy = true;
  try {
    state = await api("/api/state");
    if (!selectedBatchId) selectedBatchId = state.batches[0]?.id ?? null;
    render();
  } catch (error) {
    toast("Нет связи с локальным worker");
  } finally {
    pollBusy = false;
  }
}

async function runAction(action, jobId) {
  const batch = activeBatch();
  if (!batch) return;
  try {
    const payload = await api("/api/action", { method: "POST", body: JSON.stringify({ action, batchId: batch.id, jobId }) });
    state = payload.state;
    if (jobId) selectedJobId = jobId;
    render();
    toast(action === "start" ? "Очередь запущена" : action === "pause" ? "Очередь поставлена на паузу" : action === "retry-demo" ? "Исправленный файл возвращён в очередь" : action === "exclude" ? "Файл исключён из результата" : "Пакет отменён");
  } catch (error) {
    toast("Действие недоступно: " + error.message);
  }
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

async function createFromFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  if (files.length > 30) return toast("Не больше 30 файлов в одном пакете");
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > 12_000_000) return toast("Пакет больше локального лимита 12 MB");
  try {
    const payloadFiles = await Promise.all(files.map(async (file) => ({
      name: file.name,
      type: file.type,
      content: toBase64(await file.arrayBuffer()),
      encoding: "base64"
    })));
    const payload = await api("/api/batches", {
      method: "POST",
      body: JSON.stringify({ name: "Новый пакет · " + files.length + " файлов", recipeId: $("recipeSelect").value, files: payloadFiles })
    });
    state = payload.state;
    selectedBatchId = payload.batch.id;
    selectedJobId = null;
    render();
    toast("Пакет добавлен. Проверьте рецепт и запустите.");
  } catch (error) {
    toast("Не удалось создать пакет: " + error.message);
  }
}

$("startButton").addEventListener("click", () => runAction("start"));
$("pauseButton").addEventListener("click", () => runAction("pause"));
$("cancelButton").addEventListener("click", () => runAction("cancel"));
$("fileInput").addEventListener("change", (event) => {
  createFromFiles(event.target.files);
  event.target.value = "";
});
$("resetButton").addEventListener("click", async () => {
  try {
    const payload = await api("/api/reset", { method: "POST", body: "{}" });
    state = payload.state;
    selectedBatchId = payload.batch.id;
    selectedJobId = null;
    render();
    toast("Демо возвращено к исходному пакету");
  } catch {
    toast("Не удалось сбросить демо");
  }
});

await refresh();
setInterval(refresh, 650);
