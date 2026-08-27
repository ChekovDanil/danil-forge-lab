import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (name) => readFile(new URL(`../public/${name}`, import.meta.url), "utf8");

test("manifest описывает standalone PWA", async () => {
  const manifest = JSON.parse(await read("manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.ok(manifest.icons.length);
});

test("service worker кэширует app shell, но не API", async () => {
  const source = await read("service-worker.js");
  assert.match(source, /groundlog-shell-v1/);
  assert.match(source, /startsWith\("\/api\/"\)/);
  assert.match(source, /caches\.match/);
});

test("IndexedDB используется как локальное хранилище", async () => {
  const source = await read("idb.js");
  assert.match(source, /indexedDB\.open/);
  assert.match(source, /objectStore\("state"\)/);
});

test("интерфейс содержит явное разрешение конфликтов", async () => {
  const html = await read("index.html");
  assert.match(html, /data-resolve="merge"/);
  assert.match(html, /data-resolve="local"/);
  assert.match(html, /data-resolve="remote"/);
});
