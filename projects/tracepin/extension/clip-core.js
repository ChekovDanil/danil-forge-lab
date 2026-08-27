const TRACKING_PARAMS = new Set(["fbclid", "gclid", "yclid", "mc_cid", "mc_eid"]);

function cleanText(value, max = 5000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

export function canonicalizeUrl(value, { keepQuery = false } = {}) {
  const url = new URL(String(value));
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("unsupported_url");
  url.username = "";
  url.password = "";
  url.hash = "";
  if (!keepQuery) url.search = "";
  for (const key of [...url.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return url.toString();
}

export function normalizeTags(input = []) {
  const values = Array.isArray(input) ? input : String(input).split(',');
  const result = [];
  for (const value of values) {
    const tag = cleanText(value, 24).toLocaleLowerCase("ru-RU").replace(/^#+/, "");
    if (tag && !result.includes(tag)) result.push(tag);
    if (result.length === 6) break;
  }
  return result;
}

export function fingerprint({ url, quote }) {
  return `${canonicalizeUrl(url)}\n${cleanText(quote).toLocaleLowerCase("ru-RU")}`;
}

export function createClip(input, { id = crypto.randomUUID(), now = new Date().toISOString() } = {}) {
  const quote = cleanText(input.quote);
  const type = ['text', 'ui', 'bug', 'accessibility'].includes(input.type) ? input.type : 'text';
  if (quote.length < (type === 'text' ? 12 : 4)) throw new Error("selection_too_short");
  const url = canonicalizeUrl(input.url);
  const priority = ['normal', 'important', 'blocker'].includes(input.priority) ? input.priority : 'normal';
  return Object.freeze({
    id: cleanText(id, 100),
    title: cleanText(input.title || new URL(url).hostname, 240),
    url,
    quote,
    note: cleanText(input.note, 1000),
    tags: Object.freeze(normalizeTags(input.tags)),
    type,
    priority,
    projectId: cleanText(input.projectId || "inbox", 100),
    status: "inbox",
    source: Object.freeze({
      title: cleanText(input.title || new URL(url).hostname, 240),
      url,
      origin: new URL(url).origin,
      capturedAt: now,
      viewport: Object.freeze({ width: Number(input.viewport?.width) || 0, height: Number(input.viewport?.height) || 0 })
    }),
    anchor: Object.freeze({
      exact: quote,
      prefix: cleanText(input.anchor?.prefix, 120),
      suffix: cleanText(input.anchor?.suffix, 120),
      locator: cleanText(input.anchor?.locator, 500)
    }),
    createdAt: now,
    fingerprint: fingerprint({ url, quote })
  });
}

export function addClip(existing, input, options) {
  const candidate = createClip(input, options);
  const duplicate = existing.find((item) => item.fingerprint === candidate.fingerprint);
  if (duplicate) return { clips: structuredClone(existing), created: null, duplicateId: duplicate.id };
  return { clips: [candidate, ...existing].map((item) => structuredClone(item)), created: structuredClone(candidate), duplicateId: null };
}

export function updateClip(existing, id, patch) {
  let found = false;
  const clips = existing.map((item) => {
    if (item.id !== id) return structuredClone(item);
    found = true;
    return {
      ...structuredClone(item),
      note: cleanText(patch.note ?? item.note, 1000),
      tags: normalizeTags(patch.tags ?? item.tags),
      type: ['text', 'ui', 'bug', 'accessibility'].includes(patch.type) ? patch.type : item.type,
      priority: ['normal', 'important', 'blocker'].includes(patch.priority) ? patch.priority : item.priority
    };
  });
  if (!found) throw new Error("clip_not_found");
  return clips;
}

export function removeClip(existing, id) {
  const clips = existing.filter((item) => item.id !== id).map((item) => structuredClone(item));
  if (clips.length === existing.length) throw new Error("clip_not_found");
  return clips;
}

function tokens(value) {
  return cleanText(value).toLocaleLowerCase("ru-RU").split(/[^a-zа-я0-9]+/iu).filter((item) => item.length > 1);
}

export function searchClips(existing, query = "", selectedTags = []) {
  const queryTokens = tokens(query);
  const requiredTags = normalizeTags(selectedTags);
  return existing
    .filter((item) => requiredTags.every((tag) => item.tags.includes(tag)))
    .map((item) => {
      const title = tokens(item.title);
      const body = tokens(`${item.quote} ${item.note} ${item.tags.join(' ')}`);
      const score = queryTokens.reduce((sum, token) => sum + (title.some((word) => word.startsWith(token)) ? 3 : 0) + (body.some((word) => word.startsWith(token)) ? 1 : 0), 0);
      return { item, score };
    })
    .filter(({ score }) => !queryTokens.length || score > 0)
    .sort((a, b) => b.score - a.score || new Date(b.item.createdAt) - new Date(a.item.createdAt))
    .map(({ item }) => structuredClone(item));
}

export function exportClips(existing, exportedAt = new Date().toISOString()) {
  return JSON.stringify({ schema: "tracepin-pins/v1", exportedAt, count: existing.length, pins: structuredClone(existing) }, null, 2);
}

function markdownText(value = "") {
  return cleanText(value).replace(/([\\`*_{}\[\]()#+.!|>-])/g, "\\$1");
}

export function exportMarkdown(existing, { title = "TracePin QA brief", exportedAt = new Date().toISOString() } = {}) {
  const lines = [`# ${markdownText(title)}`, "", `Экспорт: ${exportedAt}`, `Правок: ${existing.length}`, ""];
  existing.forEach((pin, index) => {
    lines.push(`## ${index + 1}. ${markdownText(pin.title)}`, "", `- Тип: ${pin.type}`, `- Приоритет: ${pin.priority}`, `- Статус: ${pin.status}`, `- Источник: ${pin.url}`, `- Теги: ${pin.tags.map((tag) => `\`${markdownText(tag)}\``).join(", ") || "—"}`, "", `> ${markdownText(pin.quote)}`);
    if (pin.note) lines.push("", markdownText(pin.note));
    lines.push("");
  });
  return lines.join("\n");
}
