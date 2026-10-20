const test = require('node:test');
const assert = require('node:assert/strict');
const { apiHarness } = require('./helpers/api-harness.cjs');
const key = 'haskapp_calendar_events_guest';
const make = () => ({ title: 'Appointment', date: '2026-10-09', colorTheme: 'teal' });

test('same millisecond local event creates remain distinct even without randomUUID/randomness', async t => {
  const h = apiHarness(t, 'lib/api/events.ts', { owner: 'guest' });
  t.mock.method(Date, 'now', () => 1); t.mock.method(Math, 'random', () => 0);
  const old = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'crypto', old); else delete globalThis.crypto; });
  const first = await h.api.eventsApi.saveEvent(make(), []);
  const second = await h.api.eventsApi.saveEvent(make(), [first]);
  assert.notEqual(first.id, second.id);
  await h.api.eventsApi.deleteEvent(first.id, [first, second]);
  assert.deepEqual(h.cache(key), [second]);
});

test('restoring an event with an existing ID to an empty cache does not drop it', async t => {
  const h = apiHarness(t, 'lib/api/events.ts', { owner: 'guest' });
  const event = await h.api.eventsApi.saveEvent({ ...make(), id: 'ev-restored' }, []);
  assert.deepEqual(h.cache(key), [event]);
});

test('local event persistence failures surface for create and deletion', async t => {
  const h = apiHarness(t, 'lib/api/events.ts', { owner: 'guest', storageError: new Error('QuotaExceededError') });
  await assert.rejects(h.api.eventsApi.saveEvent(make(), []), /Quota/);
  await assert.rejects(h.api.eventsApi.deleteEvent('ev-1', []), /Quota/);
});
