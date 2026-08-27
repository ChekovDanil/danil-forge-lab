import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const html = readFileSync(resolve(root, "public/index.html"), "utf8");
const css = readFileSync(resolve(root, "public/style.css"), "utf8");
const server = readFileSync(resolve(root, "server.mjs"), "utf8");

test("интерфейс показывает очередь, решение и evidence stack", () => {
  for (const id of ["queue", "decisionBody", "evidenceList", "questionForm"]) assert.match(html, new RegExp(`id="${id}"`));
});

test("сервер ограничивает payload и защищает статические ответы", () => {
  assert.match(server, /32_000/);
  assert.match(server, /Content-Security-Policy/);
  assert.match(server, /frame-ancestors 'none'/);
});

test("адаптивность включает рабочий мобильный диапазон", () => {
  assert.match(css, /@media\(max-width:760px\)/);
  assert.match(css, /@media\(max-width:390px\)/);
  assert.match(css, /\.queue\{[^}]*overflow-x:auto[^}]*scrollbar-width:none/);
  assert.match(css, /\.queue::-webkit-scrollbar\{display:none\}/);
});
