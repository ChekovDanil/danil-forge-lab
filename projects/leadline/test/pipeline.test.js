import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { conversion, moveDeal, pipelineStats, removeDeal, upcoming, upsertDeal } from "../src/pipeline.js";

const deals = [
  { id: "1", company: "A", title: "Первая", amount: 100000, probability: 50, stage: "qualified", nextAt: "2026-08-26" },
  { id: "2", company: "B", title: "Вторая", amount: 50000, probability: 80, stage: "decision", nextAt: "2026-08-29" },
];

test("считает сумму, прогноз и просрочки относительно переданной даты", () => {
  assert.deepEqual(pipelineStats(deals, new Date("2026-08-27T14:00:00+07:00")), { total: 150000, weighted: 90000, overdue: 1 });
});

test("не считает сегодняшнее действие просроченным", () => {
  assert.equal(pipelineStats([{ ...deals[0], nextAt: "2026-08-27" }], new Date("2026-08-27T23:00:00+07:00")).overdue, 0);
});

test("перемещает сделку иммутабельно", () => {
  const next = moveDeal(deals, "1", "proposal");
  assert.equal(next[0].stage, "proposal");
  assert.equal(deals[0].stage, "qualified");
});

test("создаёт и редактирует полноценную сделку", () => {
  const created = upsertDeal(deals, { id: "3", company: " C ", title: " Новая ", stage: "new", amount: "12000", probability: "130" });
  assert.equal(created[0].company, "C");
  assert.equal(created[0].amount, 12000);
  assert.equal(created[0].probability, 100);
  const edited = upsertDeal(created, { ...created[0], title: "Обновлённая", stage: "proposal" });
  assert.equal(edited.length, created.length);
  assert.equal(edited[0].title, "Обновлённая");
});

test("отклоняет неполную или некорректную сделку", () => {
  assert.throws(() => upsertDeal(deals, { id: "3", company: "", title: "X", stage: "new" }), /клиента/);
  assert.throws(() => moveDeal(deals, "1", "done"), /Неизвестный/);
});

test("удаляет только выбранную сделку", () => {
  const next = removeDeal(deals, "1");
  assert.deepEqual(next.map((deal) => deal.id), ["2"]);
  assert.equal(deals.length, 2);
});

test("сортирует следующие действия", () => assert.equal(upcoming(deals)[0].id, "1"));
test("считает конверсию до решения", () => assert.equal(conversion(deals), 50));

test("интерфейс содержит полный сценарий сделки без фиктивных разделов", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  for (const id of ["dealCompany", "dealName", "dealAmount", "dealProbability", "dealNext", "dealDate", "move", "dealNote"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(app, /localStorage/);
  assert.match(app, /removeDeal/);
  assert.doesNotMatch(html, />\s*(Компании|Отч[её]ты)\s*</i);
});

test("локальный сервер ограничивает методы и отдаёт защитные заголовки", async () => {
  const server = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
  assert.match(server, /GET.*HEAD/);
  assert.match(server, /Content-Security-Policy/);
  assert.match(server, /X-Content-Type-Options/);
  assert.match(server, /Referrer-Policy/);
});
