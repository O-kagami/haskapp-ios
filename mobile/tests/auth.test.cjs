const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTs } = require('./helpers/load-ts.cjs');
const { resolveBackendConfig, DEPLOYED_WEB_BACKEND } = require('../src/backend-config.js');

const PUBLIC_URL = 'https://example.supabase.co';
const PUBLIC_KEY = 'sb_publishable_test_only';

function clientModule({ uiTest = false, configured = true, useDefault = false, testNamespace, readOnlyVerification = false, verificationOffline = false } = {}) {
  const oldURL = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const oldKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const oldDisabled = process.env.EXPO_PUBLIC_DISABLE_CLOUD;
  process.env.EXPO_PUBLIC_DISABLE_CLOUD = configured ? '0' : '1';
  if (configured && !useDefault) {
    process.env.EXPO_PUBLIC_SUPABASE_URL = PUBLIC_URL;
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = PUBLIC_KEY;
  } else {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  }
  const calls = [];
  const auth = {
    getSession: async () => { calls.push(['session']); return { data: { session: { user: { id: 'owner' } } } }; },
    signOut: async (options) => { calls.push(['signOut', options]); return { error: null }; },
  };
  let configuration;
  let api;
  try {
    api = loadTs('web-contract/lib/supabase.ts', {
      'expo-modules-core': { requireNativeModule: () => ({ isUITest: () => uiTest, isReadOnlyVerification: () => readOnlyVerification, isReadOnlyOffline: () => verificationOffline, uiTestNamespace: () => testNamespace }) },
      '@supabase/supabase-js': { processLock: () => {}, createClient: (url, key, options) => { configuration = { url, key, options }; return { auth }; } },
      'expo-secure-store': { getItemAsync: () => {}, setItemAsync: () => {}, deleteItemAsync: () => {} },
      '../../src/backend-config': { resolveBackendConfig },
    });
  } finally {
    if (oldURL === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL; else process.env.EXPO_PUBLIC_SUPABASE_URL = oldURL;
    if (oldKey === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY; else process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = oldKey;
    if (oldDisabled === undefined) delete process.env.EXPO_PUBLIC_DISABLE_CLOUD; else process.env.EXPO_PUBLIC_DISABLE_CLOUD = oldDisabled;
  }
  return { api, configuration, calls };
}

test('public client config permits publishable and legacy anon keys, never secret or service-role keys', () => {
  assert.equal(resolveBackendConfig(PUBLIC_URL, PUBLIC_KEY).configured, true);
  const jwt = (role) => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  assert.equal(resolveBackendConfig(PUBLIC_URL, jwt('anon')).configured, true);
  const unicodeClaims = Buffer.from(JSON.stringify({ role: 'anon', note: '日本語' })).toString('base64url');
  const oldAtob = globalThis.atob;
  try {
    delete globalThis.atob;
    assert.equal(resolveBackendConfig(PUBLIC_URL, `header.${unicodeClaims}.signature`).configured, true);
  } finally { globalThis.atob = oldAtob; }
  for (const key of ['sb_secret_do_not_bundle', jwt('service_role'), 'malformed']) {
    assert.throws(() => resolveBackendConfig(PUBLIC_URL, key), /publishable key or legacy anon key/);
  }
});

test('public client URL requires an HTTPS origin without embedded private data', () => {
  for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/auth', 'https://example.com?token=private', 'https://example.com#private']) {
    assert.throws(() => resolveBackendConfig(url, PUBLIC_KEY), /HTTPS origin/);
  }
  assert.throws(() => resolveBackendConfig(PUBLIC_URL, undefined), /Both public/);
  assert.equal(resolveBackendConfig(undefined, undefined).configured, true);
  assert.equal(resolveBackendConfig(undefined, undefined, false, true).configured, false);
});

test('the default native client uses the verified public Web endpoint and only its publishable key', () => {
  const { configuration, api } = clientModule({ useDefault: true });
  assert.equal(api.configured, true);
  assert.equal(configuration.url, DEPLOYED_WEB_BACKEND.url);
  assert.equal(configuration.key, DEPLOYED_WEB_BACKEND.key);
  assert.match(configuration.key, /^sb_publishable_/);
  const disabled = clientModule({ uiTest: true, useDefault: true });
  assert.equal(disabled.configuration.url, 'https://unconfigured.invalid');
  assert.equal(disabled.configuration.options.auth.persistSession, false);
});

test('UI-test mode ignores real backend configuration and never loads or mutates real auth storage', async () => {
  const { api, configuration, calls } = clientModule({ uiTest: true });
  assert.equal(api.configured, false);
  assert.equal(api.guestId, 'guest-ios-uitest');
  assert.equal(configuration.url, 'https://unconfigured.invalid');
  assert.equal(configuration.key, 'unconfigured');
  assert.equal(configuration.options.auth.storage, undefined);
  assert.equal(configuration.options.auth.persistSession, false);
  assert.equal(configuration.options.auth.autoRefreshToken, false);
  assert.equal(await api.getCurrentUser(), null);
  assert.equal(await api.getCurrentUserId(), 'guest-ios-uitest');
  await api.signOutUser();
  await assert.rejects(configuration.options.global.fetch(PUBLIC_URL), /Cloud access is disabled/);
  assert.deepEqual(calls, []);
});

test('unconfigured guest mode has no auth session or network side effects', async () => {
  const { api, configuration, calls } = clientModule({ configured: false });
  assert.equal(await api.getCurrentUserId(), 'guest-ios');
  assert.equal(await api.getCurrentUser(), null);
  await api.signOutUser();
  await assert.rejects(configuration.options.global.fetch(PUBLIC_URL), /disabled/);
  assert.deepEqual(calls, []);
});

test('UI tests can isolate repeated runs while retaining the namespace across relaunch', async () => {
  const first = clientModule({ uiTest: true, testNamespace: 'run-one' }).api;
  const restart = clientModule({ uiTest: true, testNamespace: 'run-one' }).api;
  const second = clientModule({ uiTest: true, testNamespace: 'run-two' }).api;
  assert.equal(await first.getCurrentUserId(), await restart.getCurrentUserId());
  assert.notEqual(await first.getCurrentUserId(), await second.getCurrentUserId());
  assert.equal(clientModule({ uiTest: false, testNamespace: 'run-one' }).api.guestId, 'guest-ios');
});

test('native logout ends only this device session and preserves the Web session', async () => {
  const { api, configuration, calls } = clientModule();
  assert.equal(configuration.options.auth.persistSession, true);
  assert.equal(typeof configuration.options.auth.lock, 'function');
  assert.equal(await api.getCurrentUserId(), 'owner');
  await api.signOutUser();
  assert.deepEqual(calls.at(-1), ['signOut', { scope: 'local' }]);
  assert.equal(api.getSupabaseStatus(), false);
});

test('live aggregate verification permits only GET/HEAD through the real client transport', async () => {
  const previous = globalThis.fetch; const calls = [];
  try {
    globalThis.fetch = async (...args) => { calls.push(args); return { status: 200 }; };
    const { configuration } = clientModule({ readOnlyVerification: true });
    const transport = configuration.options.global.fetch;
    await transport('https://example.supabase.co/rest/v1/grade_distributions');
    await transport('https://example.supabase.co/rest/v1/grade_distributions', { method: 'HEAD' });
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) await assert.rejects(transport('https://example.supabase.co/rest/v1/grade_distributions', { method }), /Only read-only requests/);
    await assert.rejects(transport({ method: 'POST' }), /Only read-only requests/);
    assert.equal(calls.length, 2);
  } finally { globalThis.fetch = previous; }
});

test('read-only offline verification blocks GET before network while retaining configured cache context', async () => {
  const previous = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; };
    const { configuration, api } = clientModule({ readOnlyVerification: true, verificationOffline: true });
    assert.equal(api.configured, true);
    await assert.rejects(configuration.options.global.fetch('https://example.supabase.co/rest/v1/grade_distributions'), /Offline transport/);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = previous; }
});
