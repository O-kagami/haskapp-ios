const assert = require('node:assert/strict');
const { test, afterEach } = require('node:test');
const { loadTs } = require('./helpers/load-ts.cjs');

const originalWindow = global.window;
const originalStorage = global.localStorage;
afterEach(() => {
  if (originalWindow === undefined) delete global.window; else global.window = originalWindow;
  if (originalStorage === undefined) delete global.localStorage; else global.localStorage = originalStorage;
});

function setup({ online = true, quota = false, denied = false } = {}) {
  const values = new Map([['key', JSON.stringify(['stale'])]]);
  let offlineCalls = 0;
  global.window = {};
  global.localStorage = {
    getItem(key) { if (denied) throw new Error('Access denied'); return values.get(key) ?? null; },
    setItem(key, value) { if (quota) throw new Error('QuotaExceededError'); values.set(key, value); },
    removeItem(key) { if (denied) throw new Error('Access denied'); values.delete(key); },
  };
  const api = loadTs('lib/api/offline-sync.ts', {
    '@/lib/supabase': {
      getSupabaseStatus: () => online,
      setSupabaseOffline: () => { offlineCalls++; online = false; },
    },
  });
  return { api, values, offlineCalls: () => offlineCalls };
}

test('successful fetch returns server data even when cache quota is exceeded', async () => {
  const { api, offlineCalls } = setup({ quota: true });
  assert.deepEqual(await api.fetchWithFallback('key', async () => ['fresh'], []), ['fresh']);
  assert.equal(offlineCalls(), 0);
});

test('successful insert is not reported as failed or replayed after a cache error', async () => {
  const { api, offlineCalls } = setup({ quota: true });
  let writes = 0;
  let fallbacks = 0;
  const result = await api.writeWithFallback('key', async () => { writes++; return { id: 'server-id' }; }, () => { fallbacks++; return { id: 'local-id' }; });
  assert.deepEqual(result, { id: 'server-id' });
  assert.equal(writes, 1);
  assert.equal(fallbacks, 0);
  assert.equal(offlineCalls(), 0);
});

test('successful delete/status mutation survives an optional cache failure', async () => {
  const { api } = setup({ quota: true });
  let fallbacks = 0;
  await api.mutateWithFallback('key', async () => [], () => { fallbacks++; return ['stale']; });
  assert.equal(fallbacks, 0);
});

test('offline writes must not claim success when local storage cannot save', async () => {
  const { api } = setup({ online: false, quota: true });
  await assert.rejects(api.writeWithFallback('key', async () => [], () => ['local']), /QuotaExceededError/);
  await assert.rejects(api.mutateWithFallback('key', async () => [], () => ['local']), /QuotaExceededError/);
});

test('network fallback must not claim success if its local-only write also fails', async () => {
  const { api } = setup({ quota: true });
  await assert.rejects(api.writeWithFallback('key', async () => { throw new Error('Failed to fetch'); }, () => ['local']), /QuotaExceededError/);
});

test('permissions and validation failures are not converted into successful local writes', async () => {
  const { api, values, offlineCalls } = setup();
  const error = new Error('row-level security policy violation');
  await assert.rejects(api.writeWithFallback('key', async () => { throw error; }, () => ['local']), error);
  await assert.rejects(api.mutateWithFallback('key', async () => { throw error; }, () => ['local']), error);
  assert.deepEqual(JSON.parse(values.get('key')), ['stale']);
  assert.equal(offlineCalls(), 0);
});

test('network failure retains existing cached data and opens the circuit breaker', async () => {
  const { api, offlineCalls } = setup();
  assert.deepEqual(await api.fetchWithFallback('key', async () => { throw new Error('Failed to fetch'); }, []), ['stale']);
  assert.equal(offlineCalls(), 1);
});

test('denied storage reads behave as missing cache and do not mask fetched data', async () => {
  const { api } = setup({ denied: true });
  assert.equal(api.getLocal('key'), null);
  assert.deepEqual(await api.fetchWithFallback('key', async () => ['fresh'], []), ['fresh']);
});

test('invalid cached JSON is evicted rather than throwing', () => {
  const { api, values } = setup();
  values.set('key', '{broken');
  assert.equal(api.getLocal('key'), null);
  assert.equal(values.has('key'), false);
});

test('fulfilled fetch clears its timeout', async (t) => {
  const { api } = setup();
  const handle = {};
  const clear = t.mock.method(global, 'clearTimeout');
  t.mock.method(global, 'setTimeout', () => handle);
  assert.deepEqual(await api.fetchWithFallback('key', async () => ['fresh'], []), ['fresh']);
  assert.equal(clear.mock.callCount(), 1);
  assert.equal(clear.mock.calls[0].arguments[0], handle);
});
