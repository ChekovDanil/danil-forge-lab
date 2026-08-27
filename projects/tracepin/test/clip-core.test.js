import assert from "node:assert/strict";
import test from "node:test";
import { addClip, canonicalizeUrl, createClip, exportClips, exportMarkdown, normalizeTags, removeClip, searchClips, updateClip } from "../extension/clip-core.js";
import { containsSensitiveText, validateMessage } from "../extension/message-core.js";

const input = { title: "Design systems", url: "https://example.com/article?utm_source=test&b=2&a=1#section", quote: "A design system is a shared language for product teams.", tags: ["UX", " Research "] };
const options = { id: "clip-1", now: "2026-08-27T00:00:00.000Z" };

test("canonical URL по умолчанию удаляет query, hash и userinfo", () => {
  assert.equal(canonicalizeUrl("https://name:secret@example.com/article?a=1#part"), "https://example.com/article");
});

test("разрешённый query очищается от tracking и сортируется", () => {
  assert.equal(canonicalizeUrl(input.url, { keepQuery: true }), "https://example.com/article?a=1&b=2");
});

test("не принимает небезопасный протокол", () => {
  assert.throws(() => canonicalizeUrl("javascript:alert(1)"), /unsupported_url/);
});

test("нормализует, дедуплицирует и ограничивает теги", () => {
  assert.deepEqual(normalizeTags(["#UX", "ux", " Research ", "A", "B", "C", "D", "E"]), ["ux", "research", "a", "b", "c", "d"]);
});

test("создаёт неизменяемый clip с fingerprint", () => {
  const clip = createClip({ ...input, type: "ui", priority: "important", viewport: { width: 1440, height: 900 }, anchor: { prefix: "Before", suffix: "After", locator: "[data-testid=hero]" } }, options);
  assert.equal(clip.id, "clip-1");
  assert.equal(clip.tags[0], "ux");
  assert.ok(Object.isFrozen(clip));
  assert.equal(clip.type, "ui");
  assert.equal(clip.priority, "important");
  assert.equal(clip.source.viewport.width, 1440);
  assert.equal(clip.anchor.locator, "[data-testid=hero]");
  assert.ok(clip.fingerprint.includes("example.com"));
});

test("отклоняет слишком короткий фрагмент", () => {
  assert.throws(() => createClip({ ...input, quote: "short" }, options), /selection_too_short/);
  assert.equal(createClip({ ...input, quote: "$ 840", type: "ui" }, options).quote, "$ 840");
});

test("повтор того же текста и URL не создаёт дубль", () => {
  const first = addClip([], input, options);
  const second = addClip(first.clips, { ...input, url: "https://example.com/article?a=1&b=2&utm_medium=x" }, { id: "clip-2", now: options.now });
  assert.equal(second.created, null);
  assert.equal(second.duplicateId, "clip-1");
  assert.equal(second.clips.length, 1);
});

test("одинаковый текст на другом источнике сохраняется отдельно", () => {
  const first = addClip([], input, options);
  const second = addClip(first.clips, { ...input, url: "https://other.example/page" }, { id: "clip-2", now: options.now });
  assert.equal(second.clips.length, 2);
});

test("поиск усиливает совпадение в заголовке", () => {
  const a = createClip(input, options);
  const b = createClip({ ...input, title: "Typography notes", url: "https://example.org", quote: "Design systems need deliberate typography choices." }, { id: "clip-2", now: "2026-08-28T00:00:00.000Z" });
  assert.equal(searchClips([b, a], "design system")[0].id, "clip-1");
});

test("фильтр тегов требует все выбранные теги", () => {
  const a = createClip(input, options);
  assert.equal(searchClips([a], "", ["ux", "research"]).length, 1);
  assert.equal(searchClips([a], "", ["backend"]).length, 0);
});

test("обновляет заметку и теги без изменения цитаты", () => {
  const clip = createClip(input, options);
  const updated = updateClip([clip], clip.id, { note: "Use in audit", tags: "UX, audit", type: "bug", priority: "blocker" })[0];
  assert.equal(updated.quote, clip.quote);
  assert.equal(updated.note, "Use in audit");
  assert.deepEqual(updated.tags, ["ux", "audit"]);
  assert.equal(updated.type, "bug");
  assert.equal(updated.priority, "blocker");
});

test("удаление неизвестного clip запрещено", () => {
  assert.throws(() => removeClip([], "missing"), /clip_not_found/);
});

test("экспорт имеет версию схемы и не мутирует данные", () => {
  const clip = createClip(input, options);
  const before = structuredClone(clip);
  const data = JSON.parse(exportClips([clip], "2026-08-29T00:00:00.000Z"));
  assert.equal(data.schema, "tracepin-pins/v1");
  assert.equal(data.count, 1);
  assert.equal(data.pins[0].id, clip.id);
  assert.deepEqual(clip, before);
});

test("Markdown экспорт экранирует управляющую разметку", () => {
  const clip = createClip({ ...input, quote: "Fix *bold* [link] and # heading" }, options);
  const markdown = exportMarkdown([clip], { exportedAt: options.now });
  assert.match(markdown, /\\\*bold\\\*/);
  assert.match(markdown, /\\# heading/);
});

test("message validator принимает только allowlist и ограниченный payload", () => {
  assert.equal(validateMessage({ type: "GET_STATE" }).type, "GET_STATE");
  assert.throws(() => validateMessage({ type: "EVAL" }), /unknown_message/);
  assert.throws(() => validateMessage({ type: "SAVE_PIN", input: { quote: "x".repeat(4001), url: "https://example.com" } }), /payload_too_large/);
});

test("детектор замечает email, телефон и token-like значения", () => {
  assert.equal(containsSensitiveText("mail me at user@example.com"), true);
  assert.equal(containsSensitiveText("token=abc123"), true);
  assert.equal(containsSensitiveText("ordinary interface copy"), false);
});
