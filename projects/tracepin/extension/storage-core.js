export function createSequentialRepository(adapter, { maxBytes = 4_500_000 } = {}) {
  let tail = Promise.resolve();

  const read = async () => {
    await tail;
    const value = await adapter.read();
    return Array.isArray(value) ? structuredClone(value) : [];
  };

  const mutate = (transform) => {
    const operation = tail.then(async () => {
      const current = await adapter.read();
      const result = await transform(Array.isArray(current) ? structuredClone(current) : []);
      if (!result || !Array.isArray(result.next)) throw new Error("invalid_mutation");
      const bytes = new TextEncoder().encode(JSON.stringify(result.next)).byteLength;
      if (bytes > maxBytes) throw new Error("local_soft_limit");
      await adapter.write(structuredClone(result.next));
      return structuredClone(result.value);
    });
    tail = operation.then(() => undefined, () => undefined);
    return operation;
  };

  return Object.freeze({ read, mutate });
}
