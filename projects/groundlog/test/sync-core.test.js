import assert from "node:assert/strict";
import test from "node:test";
import {
  applySyncResponse,
  createDeviceState,
  createLocalNote,
  createRemoteStore,
  editLocal,
  prepareSync,
  receiveRemoteSnapshot,
  resolveConflict,
  setOnline
} from "../src/sync-core.js";

const seed = [{
  id: "visit-north",
  title: "Северный фасад",
  body: "Проверить крепление у входной группы.",
  site: "Объект 14 · Корпус B",
  tags: ["фасад"],
  status: "draft",
  version: 3,
  updatedAt: "2026-08-27T08:00:00.000Z",
  updatedBy: "Ирина"
}];

const now = (minute) => "2026-08-27T08:" + String(minute).padStart(2, "0") + ":00.000Z";

test("создаёт локальную копию с revision remote", () => {
  const state = createDeviceState(seed, { deviceId: "phone-a" });
  assert.equal(state.records[0].baseVersion, 3);
  assert.equal(state.records[0].syncState, "synced");
  assert.equal(state.queue.length, 0);
});

test("offline edit сохраняет запись и создаёт outbox operation", () => {
  let state = setOnline(createDeviceState(seed), false);
  state = editLocal(state, "visit-north", { body: "Локальный замер: 1840 мм." }, { now: now(2), operationId: "op-1" });
  assert.equal(state.records[0].note.body, "Локальный замер: 1840 мм.");
  assert.equal(state.records[0].syncState, "pending");
  assert.equal(state.queue[0].baseVersion, 3);
});

test("повторные изменения compact в одну операцию со стабильным ID", () => {
  let state = createDeviceState(seed);
  state = editLocal(state, "visit-north", { body: "Первый вариант" }, { now: now(2), operationId: "op-stable" });
  state = editLocal(state, "visit-north", { status: "ready" }, { now: now(3), operationId: "op-new" });
  assert.equal(state.queue.length, 1);
  assert.equal(state.queue[0].id, "op-stable");
  assert.equal(state.queue[0].patch.body, "Первый вариант");
  assert.equal(state.queue[0].patch.status, "ready");
});

test("новая offline запись получает baseVersion 0", () => {
  const state = createLocalNote(createDeviceState(seed), { title: "Кровля", body: "Проверить шов", site: "Корпус B", tags: ["Срочно", "срочно"] }, { now: now(4), operationId: "op-new", noteId: "visit-roof" });
  assert.equal(state.records[0].note.id, "visit-roof");
  assert.equal(state.records[0].baseVersion, 0);
  assert.deepEqual(state.records[0].note.tags, ["срочно"]);
});

test("offline блокирует сетевую отправку, но не локальное сохранение", () => {
  const state = setOnline(createDeviceState(seed), false);
  assert.throws(() => prepareSync(state), /offline/);
});

test("сервер принимает mutation только при совпадении revision", () => {
  const store = createRemoteStore(seed, { clock: () => now(5) });
  const response = store.applyOperations([{ id: "op-1", type: "upsert", noteId: "visit-north", baseVersion: 3, patch: { body: "Принято" } }]);
  assert.equal(response.accepted.length, 1);
  assert.equal(response.accepted[0].note.version, 4);
  assert.equal(response.conflicts.length, 0);
});

test("повтор mutation ID применяется сервером один раз", () => {
  const store = createRemoteStore(seed, { clock: () => now(5) });
  const operation = { id: "op-stable", type: "upsert", noteId: "visit-north", baseVersion: 3, patch: { body: "Один раз" } };
  const first = store.applyOperations([operation]);
  const replay = store.applyOperations([operation]);
  assert.equal(first.accepted[0].note.version, 4);
  assert.equal(replay.accepted[0].note.version, 4);
  assert.equal(replay.accepted[0].replay, true);
  assert.equal(store.snapshot()[0].version, 4);
});

test("конкурентное изменение того же revision создаёт conflict", () => {
  const store = createRemoteStore(seed, { clock: () => now(6) });
  store.collaboratorEdit("visit-north", { body: "Офис: заменить крепёж." });
  const response = store.applyOperations([{ id: "op-local", noteId: "visit-north", baseVersion: 3, patch: { body: "Поле: размер 1840 мм." } }]);
  assert.equal(response.accepted.length, 0);
  assert.equal(response.conflicts[0].remote.version, 4);
  assert.equal(response.conflicts[0].remote.body, "Офис: заменить крепёж.");
});

test("apply conflict сохраняет local и remote версии", () => {
  let state = editLocal(createDeviceState(seed), "visit-north", { body: "Поле: размер 1840 мм." }, { now: now(2), operationId: "op-local" });
  state = applySyncResponse(state, { accepted: [], conflicts: [{ operationId: "op-local", noteId: "visit-north", remote: { ...seed[0], body: "Офис: заменить крепёж.", version: 4 } }] }, now(7));
  const conflict = state.records[0].conflict;
  assert.equal(state.records[0].syncState, "conflict");
  assert.equal(conflict.local.body, "Поле: размер 1840 мм.");
  assert.equal(conflict.remote.body, "Офис: заменить крепёж.");
  assert.equal(state.queue.length, 0);
});

test("remote resolution принимает серверную версию без новой операции", () => {
  let state = editLocal(createDeviceState(seed), "visit-north", { body: "Локально" }, { now: now(2), operationId: "op-1" });
  state = applySyncResponse(state, { conflicts: [{ operationId: "op-1", noteId: "visit-north", remote: { ...seed[0], body: "Сервер", version: 4 } }] }, now(7));
  state = resolveConflict(state, "visit-north", "remote", { now: now(8), operationId: "unused" });
  assert.equal(state.records[0].note.body, "Сервер");
  assert.equal(state.records[0].syncState, "synced");
  assert.equal(state.queue.length, 0);
});

test("local resolution создаёт новую mutation против актуального revision", () => {
  let state = editLocal(createDeviceState(seed), "visit-north", { body: "Локально" }, { now: now(2), operationId: "op-1" });
  state = applySyncResponse(state, { conflicts: [{ operationId: "op-1", noteId: "visit-north", remote: { ...seed[0], body: "Сервер", version: 4 } }] }, now(7));
  state = resolveConflict(state, "visit-north", "local", { now: now(8), operationId: "op-resolution" });
  assert.equal(state.records[0].note.body, "Локально");
  assert.equal(state.records[0].baseVersion, 4);
  assert.equal(state.queue[0].baseVersion, 4);
  assert.equal(state.queue[0].resolution, "local");
});

test("merge сохраняет обе версии и объединяет теги", () => {
  let state = editLocal(createDeviceState(seed), "visit-north", { body: "Поле: размер 1840 мм.", tags: ["замер"] }, { now: now(2), operationId: "op-1" });
  state = applySyncResponse(state, { conflicts: [{ operationId: "op-1", noteId: "visit-north", remote: { ...seed[0], body: "Офис: заменить крепёж.", tags: ["офис"], version: 4 } }] }, now(7));
  state = resolveConflict(state, "visit-north", "merge", { now: now(8), operationId: "op-merge" });
  assert.match(state.records[0].note.body, /Офис: заменить крепёж/);
  assert.match(state.records[0].note.body, /Поле: размер 1840 мм/);
  assert.deepEqual(state.records[0].note.tags, ["офис", "замер"]);
});

test("ручной merged body используется без скрытой перезаписи", () => {
  let state = editLocal(createDeviceState(seed), "visit-north", { body: "Локально" }, { now: now(2), operationId: "op-1" });
  state = applySyncResponse(state, { conflicts: [{ operationId: "op-1", noteId: "visit-north", remote: { ...seed[0], body: "Сервер", version: 4 } }] }, now(7));
  state = resolveConflict(state, "visit-north", "merge", { now: now(8), operationId: "op-merge", mergedBody: "Согласованный итог" });
  assert.equal(state.records[0].note.body, "Согласованный итог");
});

test("synced запись обновляется remote snapshot", () => {
  const next = { ...seed[0], body: "Новая серверная версия", version: 4 };
  const state = receiveRemoteSnapshot(createDeviceState(seed), [next]);
  assert.equal(state.records[0].note.body, "Новая серверная версия");
  assert.equal(state.records[0].baseVersion, 4);
});

test("pending запись не перезаписывается новым snapshot", () => {
  let state = editLocal(createDeviceState(seed), "visit-north", { body: "Несинхронизировано" }, { now: now(2), operationId: "op-1" });
  state = receiveRemoteSnapshot(state, [{ ...seed[0], body: "Сервер", version: 4 }]);
  assert.equal(state.records[0].note.body, "Несинхронизировано");
  assert.equal(state.records[0].baseVersion, 3);
});

test("после ack запись synced и outbox очищен", () => {
  let state = editLocal(createDeviceState(seed), "visit-north", { body: "Готово" }, { now: now(2), operationId: "op-1" });
  const store = createRemoteStore(seed, { clock: () => now(5) });
  const response = store.applyOperations(prepareSync(state).operations);
  state = applySyncResponse(state, response, now(6));
  assert.equal(state.records[0].syncState, "synced");
  assert.equal(state.records[0].note.version, 4);
  assert.equal(state.queue.length, 0);
  assert.equal(state.lastSyncAt, now(6));
});

test("редактирование открытого conflict запрещено до явного решения", () => {
  let state = editLocal(createDeviceState(seed), "visit-north", { body: "Локально" }, { now: now(2), operationId: "op-1" });
  state = applySyncResponse(state, { conflicts: [{ operationId: "op-1", noteId: "visit-north", remote: { ...seed[0], body: "Сервер", version: 4 } }] }, now(7));
  assert.throws(() => editLocal(state, "visit-north", { body: "Третья версия" }, { now: now(8), operationId: "op-2" }), /resolve_conflict_first/);
});

test("неизвестная стратегия не закрывает conflict", () => {
  let state = editLocal(createDeviceState(seed), "visit-north", { body: "Локально" }, { now: now(2), operationId: "op-1" });
  state = applySyncResponse(state, { conflicts: [{ operationId: "op-1", noteId: "visit-north", remote: { ...seed[0], body: "Сервер", version: 4 } }] }, now(7));
  assert.throws(() => resolveConflict(state, "visit-north", "magic", { now: now(8), operationId: "op-2" }), /unknown_strategy/);
});
