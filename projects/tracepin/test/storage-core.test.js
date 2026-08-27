import assert from "node:assert/strict";
import test from "node:test";
import { createSequentialRepository } from "../extension/storage-core.js";

test("параллельные мутации не теряют данные", async () => {
  let state = [];
  const repository = createSequentialRepository({
    async read() { await new Promise((resolve) => setTimeout(resolve, 3)); return structuredClone(state); },
    async write(next) { await new Promise((resolve) => setTimeout(resolve, 3)); state = structuredClone(next); }
  });
  await Promise.all([
    repository.mutate((current) => ({ next: [...current, { id: "A" }], value: "A" })),
    repository.mutate((current) => ({ next: [...current, { id: "B" }], value: "B" }))
  ]);
  assert.deepEqual((await repository.read()).map((item) => item.id), ["A", "B"]);
});

test("ошибка записи не портит предыдущее состояние и очередь продолжает работу", async () => {
  let state = [{ id: "base" }], fail = true;
  const repository = createSequentialRepository({
    async read() { return structuredClone(state); },
    async write(next) { if (fail) { fail = false; throw new Error("quota"); } state = structuredClone(next); }
  });
  await assert.rejects(repository.mutate((current) => ({ next: [...current, { id: "lost" }], value: null })), /quota/);
  await repository.mutate((current) => ({ next: [...current, { id: "kept" }], value: null }));
  assert.deepEqual((await repository.read()).map((item) => item.id), ["base", "kept"]);
});

test("soft limit проверяется до записи", async () => {
  let writes = 0;
  const repository = createSequentialRepository({ async read() { return []; }, async write() { writes += 1; } }, { maxBytes: 20 });
  await assert.rejects(repository.mutate(() => ({ next: [{ note: "x".repeat(30) }], value: null })), /local_soft_limit/);
  assert.equal(writes, 0);
});
