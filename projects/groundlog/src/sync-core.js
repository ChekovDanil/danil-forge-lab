const EDITABLE_FIELDS = ["title", "body", "site", "tags", "status"];

function clone(value) {
  return structuredClone(value);
}

function normalizeTags(tags) {
  return [...new Set((Array.isArray(tags) ? tags : []).map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 8);
}

function sanitizePatch(patch) {
  const safe = {};
  for (const key of EDITABLE_FIELDS) {
    if (!(key in (patch ?? {}))) continue;
    safe[key] = key === "tags" ? normalizeTags(patch[key]) : String(patch[key] ?? "").trim().slice(0, key === "body" ? 8000 : 300);
  }
  return safe;
}

function noteFromPatch(base, patch, now, author) {
  return {
    ...base,
    ...sanitizePatch(patch),
    updatedAt: now,
    updatedBy: author
  };
}

function findRecord(state, noteId) {
  const record = state.records.find((item) => item.note.id === noteId);
  if (!record) throw new Error("note_not_found");
  return record;
}

function findOperation(state, noteId) {
  return state.queue.find((operation) => operation.noteId === noteId && operation.type === "upsert");
}

export function createDeviceState(remoteNotes, { deviceId = "device-local" } = {}) {
  return {
    deviceId,
    online: true,
    records: (remoteNotes ?? []).map((note) => ({
      note: clone(note),
      baseVersion: note.version,
      syncState: "synced",
      conflict: null
    })),
    queue: [],
    lastSyncAt: null
  };
}

export function setOnline(input, online) {
  const state = clone(input);
  state.online = Boolean(online);
  return state;
}

export function editLocal(input, noteId, patch, { now, operationId, author = "Вы" }) {
  const state = clone(input);
  const record = findRecord(state, noteId);
  if (record.syncState === "conflict") throw new Error("resolve_conflict_first");
  const clean = sanitizePatch(patch);
  if (!Object.keys(clean).length) throw new Error("empty_patch");
  record.note = noteFromPatch(record.note, clean, now, author);
  record.syncState = "pending";
  let operation = findOperation(state, noteId);
  if (!operation) {
    operation = { id: operationId, type: "upsert", noteId, baseVersion: record.baseVersion, patch: {}, createdAt: now, attempts: 0 };
    state.queue.push(operation);
  }
  operation.patch = Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, clone(record.note[field])]));
  operation.updatedAt = now;
  return state;
}

export function createLocalNote(input, note, { now, operationId, noteId, author = "Вы" }) {
  const state = clone(input);
  const local = {
    id: noteId,
    title: String(note.title ?? "Новая заметка").trim().slice(0, 300),
    body: String(note.body ?? "").trim().slice(0, 8000),
    site: String(note.site ?? "").trim().slice(0, 300),
    tags: normalizeTags(note.tags),
    status: String(note.status ?? "draft"),
    version: 0,
    updatedAt: now,
    updatedBy: author
  };
  state.records.unshift({ note: local, baseVersion: 0, syncState: "pending", conflict: null });
  state.queue.push({
    id: operationId,
    type: "upsert",
    noteId,
    baseVersion: 0,
    patch: Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, clone(local[field])])),
    createdAt: now,
    updatedAt: now,
    attempts: 0
  });
  return state;
}

export function prepareSync(input) {
  const state = clone(input);
  if (!state.online) throw new Error("offline");
  return {
    deviceId: state.deviceId,
    operations: state.queue.map((operation) => ({ ...clone(operation), attempts: operation.attempts + 1 }))
  };
}

export function applySyncResponse(input, response, now) {
  const state = clone(input);
  const acceptedIds = new Set();
  for (const accepted of response.accepted ?? []) {
    const record = findRecord(state, accepted.note.id);
    record.note = clone(accepted.note);
    record.baseVersion = accepted.note.version;
    record.syncState = "synced";
    record.conflict = null;
    acceptedIds.add(accepted.operationId);
  }
  for (const conflict of response.conflicts ?? []) {
    const record = findRecord(state, conflict.noteId);
    record.syncState = "conflict";
    record.conflict = {
      operationId: conflict.operationId,
      local: clone(record.note),
      remote: clone(conflict.remote),
      detectedAt: now
    };
  }
  const conflictIds = new Set((response.conflicts ?? []).map((item) => item.operationId));
  state.queue = state.queue.filter((operation) => !acceptedIds.has(operation.id) && !conflictIds.has(operation.id));
  state.lastSyncAt = now;
  return state;
}

function mergeBody(local, remote) {
  const localBody = String(local ?? "").trim();
  const remoteBody = String(remote ?? "").trim();
  if (!localBody) return remoteBody;
  if (!remoteBody || localBody === remoteBody) return localBody;
  if (localBody.includes(remoteBody)) return localBody;
  if (remoteBody.includes(localBody)) return remoteBody;
  return remoteBody + "\n\n— Локальное дополнение —\n" + localBody;
}

export function resolveConflict(input, noteId, strategy, { now, operationId, mergedBody, author = "Вы" }) {
  const state = clone(input);
  const record = findRecord(state, noteId);
  if (record.syncState !== "conflict" || !record.conflict) throw new Error("conflict_not_found");
  const local = record.conflict.local;
  const remote = record.conflict.remote;
  if (strategy === "remote") {
    record.note = clone(remote);
    record.baseVersion = remote.version;
    record.syncState = "synced";
    record.conflict = null;
    return state;
  }
  if (!["local", "merge"].includes(strategy)) throw new Error("unknown_strategy");
  const merged = strategy === "local" ? local : {
    ...remote,
    title: local.title || remote.title,
    body: typeof mergedBody === "string" ? mergedBody.trim().slice(0, 8000) : mergeBody(local.body, remote.body),
    site: local.site || remote.site,
    tags: normalizeTags([...(remote.tags ?? []), ...(local.tags ?? [])]),
    status: local.status || remote.status
  };
  record.note = noteFromPatch(remote, merged, now, author);
  record.baseVersion = remote.version;
  record.syncState = "pending";
  record.conflict = null;
  state.queue.push({
    id: operationId,
    type: "upsert",
    noteId,
    baseVersion: remote.version,
    patch: Object.fromEntries(EDITABLE_FIELDS.map((field) => [field, clone(record.note[field])])),
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    resolution: strategy
  });
  return state;
}

export function receiveRemoteSnapshot(input, remoteNotes) {
  const state = clone(input);
  const remoteById = new Map((remoteNotes ?? []).map((note) => [note.id, note]));
  for (const record of state.records) {
    if (record.syncState !== "synced") continue;
    const remote = remoteById.get(record.note.id);
    if (remote && remote.version > record.baseVersion) {
      record.note = clone(remote);
      record.baseVersion = remote.version;
    }
  }
  for (const remote of remoteNotes ?? []) {
    if (!state.records.some((record) => record.note.id === remote.id)) state.records.push({ note: clone(remote), baseVersion: remote.version, syncState: "synced", conflict: null });
  }
  return state;
}

export function createRemoteStore(seed, { clock = () => new Date().toISOString() } = {}) {
  const notes = new Map((seed ?? []).map((note) => [note.id, clone(note)]));
  const processed = new Map();

  function snapshot() {
    return [...notes.values()].map(clone);
  }

  function applyOperations(operations, author = "Field team") {
    const accepted = [];
    const conflicts = [];
    for (const operation of operations ?? []) {
      if (processed.has(operation.id)) {
        accepted.push({ operationId: operation.id, note: clone(processed.get(operation.id)), replay: true });
        continue;
      }
      const current = notes.get(operation.noteId);
      const currentVersion = current?.version ?? 0;
      if (operation.baseVersion !== currentVersion) {
        conflicts.push({ operationId: operation.id, noteId: operation.noteId, remote: clone(current) });
        continue;
      }
      const next = noteFromPatch(current ?? { id: operation.noteId, version: 0 }, operation.patch, clock(), author);
      next.version = currentVersion + 1;
      notes.set(next.id, next);
      processed.set(operation.id, clone(next));
      accepted.push({ operationId: operation.id, note: clone(next), replay: false });
    }
    return { accepted, conflicts };
  }

  function collaboratorEdit(noteId, patch, author = "Ирина") {
    const current = notes.get(noteId);
    if (!current) throw new Error("note_not_found");
    const next = noteFromPatch(current, patch, clock(), author);
    next.version = current.version + 1;
    notes.set(noteId, next);
    return clone(next);
  }

  return Object.freeze({ snapshot, applyOperations, collaboratorEdit });
}
