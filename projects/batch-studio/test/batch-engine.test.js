import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createBatchEngine, detectImageType, normalizeOutputName, processImage, RECIPES } from "../src/batch-engine.js";

function makeEngine() {
  let tick = 0;
  return createBatchEngine({
    clock: () => "2026-08-27T00:00:" + String(tick++).padStart(2, "0") + ".000Z",
    id: () => "id-" + tick++
  });
}

async function fixture({ width = 1400, height = 900, alpha = false, format = "png", color = "#5d6bff" } = {}) {
  let pipeline = sharp({ create: { width, height, channels: alpha ? 4 : 3, background: color } });
  pipeline = format === "jpeg" ? pipeline.jpeg({ quality: 92 }) : format === "webp" ? pipeline.webp() : pipeline.png();
  const buffer = await pipeline.toBuffer();
  return { name: "Campaign Hero FINAL." + (format === "jpeg" ? "jpg" : format), type: "image/" + format, content: buffer.toString("base64"), encoding: "base64" };
}

test("recipe snapshot имеет версию, три варианта и безопасный upscale policy", () => {
  assert.equal(RECIPES["web-delivery"].version, 1);
  assert.equal(RECIPES["web-delivery"].variants.length, 3);
  assert.equal(RECIPES["web-delivery"].fit, "inside");
});

test("определяет реальный тип по сигнатуре, а не расширению", async () => {
  const png = Buffer.from((await fixture()).content, "base64");
  const jpeg = Buffer.from((await fixture({ format: "jpeg" })).content, "base64");
  const webp = Buffer.from((await fixture({ format: "webp" })).content, "base64");
  assert.equal(detectImageType(png), "png");
  assert.equal(detectImageType(jpeg), "jpeg");
  assert.equal(detectImageType(webp), "webp");
  assert.equal(detectImageType(Buffer.from("not-an-image")), null);
});

test("нормализует output name детерминированно", () => {
  assert.equal(normalizeOutputName(" Campaign Hero FINAL.PNG ", "thumb", "webp"), "campaign-hero-final-thumb.webp");
});

test("web delivery создаёт три читаемых WebP без увеличения", async () => {
  const source = await fixture({ width: 820, height: 540 });
  const result = await processImage(source, "web-delivery");
  assert.equal(result.outputs.length, 3);
  for (const output of result.outputs) {
    const metadata = await sharp(Buffer.from(output.content, "base64")).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width <= 820, true);
    assert.equal(metadata.height <= 540, true);
    assert.equal(output.sha256.length, 64);
  }
});

test("marketplace square даёт квадратный JPEG с явным фоном", async () => {
  const source = await fixture({ width: 1000, height: 600, alpha: true });
  const result = await processImage(source, "marketplace-square");
  assert.equal(result.outputs.length, 3);
  for (const output of result.outputs) {
    const metadata = await sharp(Buffer.from(output.content, "base64")).metadata();
    assert.equal(metadata.format, "jpeg");
    assert.equal(metadata.width, metadata.height);
    assert.equal(metadata.hasAlpha, false);
  }
});

test("неподдерживаемый и повреждённый файл не проходит обработку", async () => {
  await assert.rejects(processImage({ name: "fake.png", content: Buffer.from("text").toString("base64"), encoding: "base64" }), /unsupported_image/);
});

test("создаёт готовую очередь без фонового старта", async () => {
  const queue = makeEngine();
  const batch = queue.createBatch({ name: "Campaign 08", recipeId: "web-delivery", files: [await fixture()] });
  assert.equal(batch.status, "ready");
  assert.equal(batch.summary.counts.queued, 1);
});

test("одинаковые исходники помечаются ссылкой, но не удаляются", async () => {
  const queue = makeEngine();
  const file = await fixture();
  const batch = queue.createBatch({ name: "Duplicates", recipeId: "web-delivery", files: [file, { ...file, name: "copy.png" }] });
  assert.equal(batch.jobs[0].duplicateOf, null);
  assert.equal(batch.jobs[1].duplicateOf, 1);
  assert.equal(batch.jobs.length, 2);
});

test("обрабатывает FIFO и собирает проверяемый manifest", async () => {
  const queue = makeEngine();
  let batch = queue.createBatch({ name: "Campaign 08", recipeId: "web-delivery", files: [await fixture(), await fixture({ color: "#da6753" })] });
  queue.start(batch.id);
  batch = await queue.processNext(batch.id);
  assert.equal(batch.jobs[0].status, "succeeded");
  assert.equal(batch.jobs[1].status, "queued");
  batch = await queue.processNext(batch.id);
  assert.equal(batch.status, "completed");
  const manifest = queue.manifest(batch.id);
  assert.equal(manifest.schema, "batch-studio-manifest/v1");
  assert.equal(manifest.files.every((file) => file.outputs.length === 3), true);
  assert.equal(manifest.summary.outputFiles, 6);
});

test("ошибка одного изображения не останавливает остальные", async () => {
  const queue = makeEngine();
  const invalid = { name: "broken.png", content: Buffer.from("broken").toString("base64"), encoding: "base64" };
  let batch = queue.createBatch({ name: "Mixed", recipeId: "web-delivery", files: [invalid, await fixture()] });
  queue.start(batch.id);
  await queue.processNext(batch.id);
  batch = await queue.processNext(batch.id);
  assert.equal(batch.status, "needs_attention");
  assert.equal(batch.summary.counts.failed, 1);
  assert.equal(batch.summary.counts.succeeded, 1);
});

test("retry заменяет только failed input и не дублирует done outputs", async () => {
  const queue = makeEngine();
  const invalid = { name: "broken.png", content: Buffer.from("broken").toString("base64"), encoding: "base64" };
  let batch = queue.createBatch({ name: "Retry", recipeId: "web-delivery", files: [await fixture(), invalid] });
  queue.start(batch.id);
  await queue.processNext(batch.id);
  batch = await queue.processNext(batch.id);
  const doneOutputs = batch.jobs[0].result.outputs.map((output) => output.sha256);
  queue.retry(batch.id, batch.jobs[1].id, await fixture({ color: "#e3b755" }));
  batch = await queue.processNext(batch.id);
  assert.equal(batch.status, "completed");
  assert.deepEqual(batch.jobs[0].result.outputs.map((output) => output.sha256), doneOutputs);
  assert.equal(batch.jobs[1].attempts, 2);
});

test("failed item можно исключить с честным warning", async () => {
  const queue = makeEngine();
  const invalid = { name: "broken.png", content: Buffer.from("broken").toString("base64"), encoding: "base64" };
  let batch = queue.createBatch({ name: "Warning", recipeId: "web-delivery", files: [invalid] });
  queue.start(batch.id);
  batch = await queue.processNext(batch.id);
  batch = queue.exclude(batch.id, batch.jobs[0].id);
  assert.equal(batch.status, "completed_with_warnings");
});

test("pause не берёт новый item, resume продолжает checkpoint", async () => {
  const queue = makeEngine();
  const batch = queue.createBatch({ name: "Pause", recipeId: "web-delivery", files: [await fixture(), await fixture({ color: "#d46f92" })] });
  queue.start(batch.id);
  queue.pause(batch.id);
  let after = await queue.processNext(batch.id);
  assert.equal(after.summary.done, 0);
  queue.start(batch.id);
  after = await queue.processNext(batch.id);
  assert.equal(after.summary.done, 1);
});

test("cancel сохраняет done outputs и закрывает pending", async () => {
  const queue = makeEngine();
  let batch = queue.createBatch({ name: "Cancel", recipeId: "web-delivery", files: [await fixture(), await fixture({ color: "#8a66b8" })] });
  queue.start(batch.id);
  batch = await queue.processNext(batch.id);
  const readyHash = batch.jobs[0].result.outputs[0].sha256;
  batch = queue.cancel(batch.id);
  assert.equal(batch.status, "cancelled");
  assert.equal(batch.jobs[0].result.outputs[0].sha256, readyHash);
  assert.equal(batch.jobs[1].status, "cancelled");
});

test("лимиты и неизвестный recipe блокируются до старта", async () => {
  const queue = makeEngine();
  const file = await fixture({ width: 100, height: 100 });
  assert.throws(() => queue.createBatch({ name: "Empty", recipeId: "web-delivery", files: [] }), /files_required/);
  assert.throws(() => queue.createBatch({ name: "Unknown", recipeId: "anything", files: [file] }), /unknown_recipe/);
  assert.throws(() => queue.createBatch({ name: "Many", recipeId: "web-delivery", files: Array.from({ length: 31 }, () => file) }), /too_many_files/);
});

test("bundle содержит только verified outputs и manifest", async () => {
  const queue = makeEngine();
  let batch = queue.createBatch({ name: "Bundle", recipeId: "web-delivery", files: [await fixture()] });
  queue.start(batch.id);
  batch = await queue.processNext(batch.id);
  const bundle = queue.bundle(batch.id);
  assert.equal(bundle.files.length, 3);
  assert.equal(bundle.manifest.batch.status, "completed");
  assert.equal(bundle.files.every((file) => file.encoding === "base64"), true);
});
