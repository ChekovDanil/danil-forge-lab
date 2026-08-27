const clone = (value) => structuredClone(value);
const clean = (value) => String(value ?? '').trim().replace(/\s+/g, ' ');

export function canonicalUrl(value) {
  const url = new URL(value);
  url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|ref$|source$)/i.test(key)) url.searchParams.delete(key);
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url.toString();
}

export function normalizeEntry(raw) {
  if (raw.visibility !== 'public') throw new Error('non_public_source');
  const title = clean(raw.title);
  const url = canonicalUrl(raw.url);
  if (!title || !url) throw new Error('invalid_entry');
  const source = clean(raw.source) || 'Public feed';
  const sourceId = clean(raw.id);
  const key = sourceId ? `${source.toLowerCase()}:${sourceId}` : url.toLowerCase();
  return {
    key, sourceId, source, title, url,
    category: clean(raw.category) || 'Другое',
    budget: clean(raw.budget) || 'Не указан',
    publishedAt: new Date(raw.publishedAt).toISOString(),
    summary: clean(raw.summary),
    tags: [...new Set((raw.tags ?? []).map((tag) => clean(tag).toLowerCase()).filter(Boolean))].sort()
  };
}

function changes(previous, current) {
  return ['title', 'category', 'budget', 'publishedAt', 'summary', 'tags'].filter((field) => JSON.stringify(previous[field]) !== JSON.stringify(current[field]));
}

export class PublicWatch {
  constructor() { this.entries = new Map(); this.events = []; this.runs = 0; }

  ingest(rawEntries, at = new Date().toISOString()) {
    const normalized = [];
    let rejected = 0;
    for (const raw of rawEntries) {
      try { normalized.push(normalizeEntry(raw)); } catch { rejected += 1; }
    }
    const batch = new Map();
    let duplicates = 0;
    for (const entry of normalized) {
      const existing = batch.get(entry.key);
      if (!existing) batch.set(entry.key, entry);
      else {
        duplicates += 1;
        batch.set(entry.key, {
          ...existing,
          ...entry,
          summary: existing.summary.length >= entry.summary.length ? existing.summary : entry.summary,
          tags: [...new Set([...existing.tags, ...entry.tags])].sort()
        });
      }
    }
    let added = 0; let changed = 0;
    for (const [key, entry] of batch) {
      const previous = this.entries.get(key);
      if (!previous) {
        added += 1;
        this.entries.set(key, { ...entry, state: 'new', changes: [], firstSeenAt: at, lastSeenAt: at });
        this.events.unshift({ type: 'added', title: entry.title, source: entry.source, at });
      } else {
        const fields = changes(previous, entry);
        if (fields.length) {
          changed += 1;
          this.events.unshift({ type: 'changed', title: entry.title, source: entry.source, fields, at });
        }
        this.entries.set(key, { ...previous, ...entry, state: fields.length ? 'changed' : previous.state, changes: fields, lastSeenAt: at });
      }
    }
    this.runs += 1;
    const result = { run: this.runs, accepted: batch.size, added, changed, duplicates, rejected, at };
    this.events.unshift({ type: 'run', title: `Обработано ${batch.size} записей`, source: 'Система', result, at });
    return clone(result);
  }

  list({ source = 'all', category = 'all', state = 'all', query = '' } = {}) {
    const needle = clean(query).toLowerCase();
    return clone([...this.entries.values()].filter((entry) =>
      (source === 'all' || entry.source === source) &&
      (category === 'all' || entry.category === category) &&
      (state === 'all' || entry.state === state) &&
      (!needle || `${entry.title} ${entry.summary} ${entry.tags.join(' ')}`.toLowerCase().includes(needle))
    ).sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt)));
  }

  get(key) { const entry = this.entries.get(key); if (!entry) throw new Error('entry_not_found'); return clone(entry); }
  history() { return clone(this.events); }
  summary() { const values = [...this.entries.values()]; return { total: values.length, new: values.filter((e) => e.state === 'new').length, changed: values.filter((e) => e.state === 'changed').length, sources: new Set(values.map((e) => e.source)).size }; }
  facets() { const values = [...this.entries.values()]; return { sources: [...new Set(values.map((e) => e.source))].sort(), categories: [...new Set(values.map((e) => e.category))].sort() }; }
  toJSON() { return JSON.stringify(this.list(), null, 2); }
  toCSV() {
    const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
    const head = ['source', 'title', 'category', 'budget', 'publishedAt', 'state', 'url'];
    return [head.join(','), ...this.list().map((entry) => head.map((field) => quote(entry[field])).join(','))].join('\n');
  }
}
