const { loadTs } = require('./load-ts.cjs');

function apiHarness(t, module, options = {}) {
  let owner = options.owner ?? '11111111-1111-4111-8111-111111111111';
  let online = options.online ?? true;
  let authReads = 0;
  const store = new Map();
  const requests = [];
  for (const [name, value] of Object.entries({
    window: {},
    localStorage: {
      getItem: key => store.get(key) ?? null,
      setItem: (key, value) => { if (options.storageError) throw options.storageError; store.set(key, value); },
      removeItem: key => store.delete(key),
    },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else delete globalThis[name]; });
  }
  const supabase = { from(table) {
    const query = { table, operation: 'select', filters: [] };
    const builder = {
      select(columns) { query.columns = columns; return builder; },
      insert(payload) { query.operation = 'insert'; query.payload = payload; return builder; },
      update(payload) { query.operation = 'update'; query.payload = payload; return builder; },
      delete() { query.operation = 'delete'; return builder; },
      eq(column, value) { query.filters.push([column, value]); return builder; },
      is(column, value) { query.filters.push([column, value]); (query.isFilters ??= []).push([column, value]); return builder; },
      in(column, value) { query.filters.push([column, value]); return builder; },
      ilike(column, value) { query.filters.push([column, value]); return builder; },
      limit(count) { query.limit = count; return builder; },
      single() { query.single = true; return builder; },
      maybeSingle() { query.maybeSingle = true; return builder; },
      then(resolve, reject) {
        requests.push(query);
        return Promise.resolve().then(() => options.respond ? options.respond(query) : { data: [], error: null }).then(resolve, reject);
      },
    };
    return builder;
  } };
  return {
    api: loadTs(module, {
      '@/lib/supabase': {
        supabase,
        getCurrentUserId: async () => {
          authReads++;
          if (options.beforeOwnerRead) await options.beforeOwnerRead(authReads);
          return owner;
        },
        getSupabaseStatus: () => online,
        setSupabaseOffline: () => { online = false; },
      },
    }),
    store, requests,
    setOwner(value) { owner = value; },
    setOnline(value) { online = value; },
    authReads: () => authReads,
    seed(key, value) { store.set(key, JSON.stringify(value)); },
    cache(key) { return JSON.parse(store.get(key) ?? 'null'); },
  };
}
module.exports = { apiHarness };
