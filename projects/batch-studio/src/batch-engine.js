import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";

const MAX_FILES = 30;
const MAX_TOTAL_BYTES = 12_000_000;
const MAX_PIXELS = 30_000_000;
const ACTIVE_JOBS = new Set(["queued", "processing"]);

export const RECIPES = Object.freeze({
  "web-delivery": Object.freeze({
    id: "web-delivery",
    version: 1,
    label: "Web delivery",
    format: "webp",
    quality: 82,
    fit: "inside",
    background: null,
    variants: Object.freeze([
      Object.freeze({ name: "hero", width: 1600, height: 1200 }),
      Object.freeze({ name: "card", width: 960, height: 720 }),
      Object.freeze({ name: "thumb", width: 480, height: 360 })
    ])
  }),
  "marketplace-square": Object.freeze({
    id: "marketplace-square",
    version: 1,
    label: "Marketplace square",
    format: "jpeg",
    quality: 88,
    fit: "contain",
    background: "#f3f1eb",
    variants: Object.freeze([
      Object.freeze({ name: "listing", width: 1200, height: 1200 }),
      Object.freeze({ name: "preview", width: 600, height: 600 }),
      Object.freeze({ name: "thumb", width: 300, height: 300 })
    ])
  })
});

function clone(value) {
  return structuredClone(value);
}

function decodeFile(file) {
  const encoding = file.encoding === "base64" ? "base64" : "utf8";
  return Buffer.from(String(file.content ?? ""), encoding);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "jpeg";
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

function safeBaseName(name) {
  const trimmed = String(name ?? "").trim();
  const raw = trimmed.replace(/\.[^.]+$/u, "");
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase()
    .slice(0, 64) || "image";
}

export function normalizeOutputName(name, variant, format) {
  return safeBaseName(name) + "-" + variant + "." + format;
}

export async function processImage(file, recipeId = "web-delivery") {
  const recipe = RECIPES[recipeId];
  if (!recipe) throw new Error("unknown_recipe");
  const input = decodeFile(file);
  const detected = detectImageType(input);
  if (!detected) throw new Error("unsupported_image");
  const source = sharp(input, { failOn: "error", limitInputPixels: MAX_PIXELS });
  let metadata;
  try {
    metadata = await source.metadata();
  } catch {
    throw new Error("corrupt_image");
  }
  if (!metadata.width || !metadata.height) throw new Error("missing_dimensions");
  if (metadata.width * metadata.height > MAX_PIXELS) throw new Error("pixel_limit");

  const outputs = [];
  for (const variant of recipe.variants) {
    let pipeline = sharp(input, { failOn: "error", limitInputPixels: MAX_PIXELS }).rotate();
    if (recipe.fit === "contain") {
      pipeline = pipeline
        .flatten({ background: recipe.background })
        .resize({ width: variant.width, height: variant.height, fit: "contain", background: recipe.background, withoutEnlargement: true });
    } else {
      pipeline = pipeline.resize({ width: variant.width, height: variant.height, fit: "inside", withoutEnlargement: true });
    }
    pipeline = recipe.format === "jpeg"
      ? pipeline.jpeg({ quality: recipe.quality, mozjpeg: true })
      : pipeline.webp({ quality: recipe.quality, effort: 4 });
    const buffer = await pipeline.toBuffer();
    const verified = await sharp(buffer).metadata();
    if (verified.format !== recipe.format || !verified.width || !verified.height) throw new Error("output_verification_failed");
    if (verified.width > variant.width || verified.height > variant.height) throw new Error("output_dimensions_failed");
    outputs.push({
      variant: variant.name,
      name: normalizeOutputName(file.name, variant.name, recipe.format),
      mime: recipe.format === "jpeg" ? "image/jpeg" : "image/webp",
      width: verified.width,
      height: verified.height,
      bytes: buffer.byteLength,
      sha256: sha256(buffer),
      content: buffer.toString("base64"),
      encoding: "base64"
    });
  }

  return {
    source: {
      name: String(file.name),
      detectedMime: "image/" + detected,
      width: metadata.width,
      height: metadata.height,
      bytes: input.byteLength,
      sha256: sha256(input),
      hasAlpha: Boolean(metadata.hasAlpha),
      orientation: metadata.orientation ?? 1
    },
    recipe: clone(recipe),
    outputs
  };
}

function computeStatus(batch) {
  if (batch.cancelledAt) return "cancelled";
  if (batch.jobs.some((job) => job.status === "processing")) return "running";
  if (batch.jobs.some((job) => job.status === "queued")) return batch.startedAt ? "running" : "ready";
  if (batch.jobs.some((job) => job.status === "failed")) return "needs_attention";
  if (batch.jobs.some((job) => ["excluded", "cancelled"].includes(job.status))) return "completed_with_warnings";
  return "completed";
}

function summarize(batch) {
  const counts = Object.fromEntries(["queued", "processing", "succeeded", "failed", "excluded", "cancelled"].map((status) => [status, 0]));
  for (const job of batch.jobs) counts[job.status] = (counts[job.status] ?? 0) + 1;
  const done = counts.succeeded + counts.failed + counts.excluded + counts.cancelled;
  return {
    counts,
    total: batch.jobs.length,
    done,
    progress: batch.jobs.length ? Math.round((done / batch.jobs.length) * 100) : 0,
    inputBytes: batch.jobs.reduce((sum, job) => sum + job.inputBytes, 0),
    outputBytes: batch.jobs.reduce((sum, job) => sum + (job.result?.outputs.reduce((value, output) => value + output.bytes, 0) ?? 0), 0),
    outputFiles: batch.jobs.reduce((sum, job) => sum + (job.result?.outputs.length ?? 0), 0)
  };
}

export function createBatchEngine({ clock = () => new Date().toISOString(), id = randomUUID } = {}) {
  const batches = [];

  function findBatch(batchId) {
    const batch = batches.find((item) => item.id === batchId);
    if (!batch) throw new Error("batch_not_found");
    return batch;
  }

  function findJob(batch, jobId) {
    const job = batch.jobs.find((item) => item.id === jobId);
    if (!job) throw new Error("job_not_found");
    return job;
  }

  function update(batch) {
    batch.status = computeStatus(batch);
    batch.summary = summarize(batch);
    batch.updatedAt = clock();
    if (["completed", "completed_with_warnings", "cancelled"].includes(batch.status) && !batch.finishedAt) batch.finishedAt = clock();
  }

  function createBatch(input) {
    const files = Array.isArray(input.files) ? input.files : [];
    if (!files.length) throw new Error("files_required");
    if (files.length > MAX_FILES) throw new Error("too_many_files");
    if (!RECIPES[input.recipeId]) throw new Error("unknown_recipe");
    const totalBytes = files.reduce((sum, file) => sum + decodeFile(file).byteLength, 0);
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error("batch_too_large");
    const createdAt = clock();
    const fingerprints = new Map();
    const jobs = files.map((file, index) => {
      const input = decodeFile(file);
      const fingerprint = sha256(input);
      const duplicateOf = fingerprints.get(fingerprint) ?? null;
      fingerprints.set(fingerprint, duplicateOf ?? index + 1);
      return {
        id: id(),
        order: index + 1,
        name: String(file.name || "image-" + (index + 1)).slice(0, 180),
        type: String(file.type || "application/octet-stream").slice(0, 100),
        content: String(file.content ?? ""),
        encoding: file.encoding === "base64" ? "base64" : "utf8",
        inputBytes: input.byteLength,
        inputSha256: fingerprint,
        duplicateOf,
        status: "queued",
        attempts: 0,
        error: null,
        result: null,
        startedAt: null,
        finishedAt: null
      };
    });
    const batch = {
      id: id(),
      name: String(input.name || "Новый пакет").trim().slice(0, 120),
      recipeId: input.recipeId,
      recipe: clone(RECIPES[input.recipeId]),
      status: "ready",
      createdAt,
      updatedAt: createdAt,
      startedAt: null,
      finishedAt: null,
      cancelledAt: null,
      jobs
    };
    batch.summary = summarize(batch);
    batches.unshift(batch);
    return clone(batch);
  }

  function start(batchId) {
    const batch = findBatch(batchId);
    if (batch.cancelledAt || !batch.jobs.some((job) => job.status === "queued")) throw new Error("nothing_to_start");
    batch.startedAt ??= clock();
    update(batch);
    return clone(batch);
  }

  function pause(batchId) {
    const batch = findBatch(batchId);
    if (batch.status !== "running") throw new Error("batch_not_running");
    batch.startedAt = null;
    update(batch);
    return clone(batch);
  }

  async function processNext(batchId) {
    const batch = findBatch(batchId);
    if (!batch.startedAt || batch.cancelledAt) return clone(batch);
    const job = batch.jobs.find((item) => item.status === "queued");
    if (!job) {
      update(batch);
      return clone(batch);
    }
    job.status = "processing";
    job.attempts += 1;
    job.startedAt = clock();
    update(batch);
    try {
      job.result = await processImage(job, batch.recipeId);
      if (job.result.source.sha256 !== job.inputSha256) throw new Error("source_hash_changed");
      job.status = "succeeded";
      job.error = null;
    } catch (error) {
      job.status = "failed";
      job.result = null;
      job.error = error.message || "processing_failed";
    }
    job.finishedAt = clock();
    update(batch);
    return clone(batch);
  }

  function retry(batchId, jobId, replacementFile) {
    const batch = findBatch(batchId);
    const job = findJob(batch, jobId);
    if (job.status !== "failed") throw new Error("job_not_failed");
    if (replacementFile) {
      const input = decodeFile(replacementFile);
      job.name = String(replacementFile.name || job.name);
      job.type = String(replacementFile.type || job.type);
      job.content = String(replacementFile.content ?? "");
      job.encoding = replacementFile.encoding === "base64" ? "base64" : "utf8";
      job.inputBytes = input.byteLength;
      job.inputSha256 = sha256(input);
    }
    job.status = "queued";
    job.error = null;
    job.result = null;
    job.finishedAt = null;
    batch.startedAt = clock();
    batch.finishedAt = null;
    update(batch);
    return clone(batch);
  }

  function exclude(batchId, jobId) {
    const batch = findBatch(batchId);
    const job = findJob(batch, jobId);
    if (job.status !== "failed") throw new Error("job_not_failed");
    job.status = "excluded";
    job.error = null;
    update(batch);
    return clone(batch);
  }

  function cancel(batchId) {
    const batch = findBatch(batchId);
    if (!["ready", "running"].includes(batch.status)) throw new Error("batch_not_active");
    batch.cancelledAt = clock();
    batch.startedAt = null;
    for (const job of batch.jobs) if (ACTIVE_JOBS.has(job.status)) job.status = "cancelled";
    update(batch);
    return clone(batch);
  }

  function manifest(batchId) {
    const batch = findBatch(batchId);
    return {
      schema: "batch-studio-manifest/v1",
      batch: {
        id: batch.id,
        name: batch.name,
        recipe: { id: batch.recipe.id, version: batch.recipe.version },
        status: batch.status,
        createdAt: batch.createdAt,
        finishedAt: batch.finishedAt
      },
      summary: clone(batch.summary),
      files: batch.jobs.map((job) => ({
        input: { name: job.name, bytes: job.inputBytes, sha256: job.inputSha256 },
        duplicateOf: job.duplicateOf,
        status: job.status,
        attempts: job.attempts,
        error: job.error,
        outputs: job.result ? job.result.outputs.map(({ content, encoding, ...output }) => output) : []
      }))
    };
  }

  function bundle(batchId) {
    const batch = findBatch(batchId);
    return {
      manifest: manifest(batchId),
      files: batch.jobs.flatMap((job) => job.status === "succeeded" ? job.result.outputs.map((output) => ({
        name: output.name,
        content: output.content,
        encoding: output.encoding
      })) : [])
    };
  }

  function getOutput(batchId, jobId, variant) {
    const batch = findBatch(batchId);
    const job = findJob(batch, jobId);
    const output = job.result?.outputs.find((item) => item.variant === variant);
    if (!output) throw new Error("output_not_found");
    return { name: output.name, mime: output.mime, buffer: Buffer.from(output.content, "base64") };
  }

  function state() {
    return clone({
      recipes: Object.values(RECIPES),
      batches: batches.map((batch) => ({
        ...batch,
        jobs: batch.jobs.map(({ content, ...job }) => ({
          ...job,
          result: job.result ? {
            ...job.result,
            outputs: job.result.outputs.map(({ content: outputContent, ...output }) => output)
          } : null
        }))
      }))
    });
  }

  return Object.freeze({ createBatch, start, pause, processNext, retry, exclude, cancel, manifest, bundle, getOutput, state });
}
