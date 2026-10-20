const test = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {loadTs} = require('./helpers/load-ts.cjs');

const callback = 'haskapp://auth/callback';
const sessionResult = () => ({data: {session: {user: {id: 'owner'}}, user: {id: 'owner'}}, error: null});

function fixture({configured = true, redirect = callback, send, exchange} = {}) {
  const requests = [], exchanges = [], redirects = [];
  const api = loadTs('src/auth-flow.ts', {
    '../web-contract/lib/supabase': {configured, supabase: {auth: {
      signInWithOtp: async request => {requests.push(request); return send ? send(request) : {data: {user: null, session: null}, error: null};},
      exchangeCodeForSession: async code => {exchanges.push(code); return exchange ? exchange(code) : sessionResult();},
    }}},
    'expo-auth-session': {makeRedirectUri: options => {redirects.push(options); return redirect;}},
    'expo-crypto': {
      CryptoDigestAlgorithm: {SHA256: 'SHA-256'},
      digestStringAsync: async (algorithm, value) => {
        assert.equal(algorithm, 'SHA-256');
        return createHash('sha256').update(value).digest('hex');
      },
    },
  });
  return {api, requests, exchanges, redirects};
}

test('email sign-in matches Web signup policy and trims email for the native PKCE redirect', async () => {
  const {api, requests, redirects, exchanges} = fixture();
  assert.equal(await api.requestEmailLink('  Student+app@example.com  '), undefined);
  assert.deepEqual(requests, [{email: 'Student+app@example.com', options: {emailRedirectTo: callback, shouldCreateUser: true}}]);
  assert.deepEqual(redirects, [{scheme: 'haskapp', path: 'auth/callback', native: callback}]);
  assert.deepEqual(exchanges, []);
});

test('invalid email is rejected locally before sending', async () => {
  const {api, requests} = fixture();
  for (const email of ['', '  ', 'no-at-sign', '@example.com', 'two@@example.com', 'a b@example.com', 'a@example.com\nheader', `${'x'.repeat(250)}@example.com`, null, {}]) {
    await assert.rejects(api.requestEmailLink(email), /メールアドレス/);
  }
  assert.deepEqual(requests, []);
});

test('UI-test and unconfigured sessions do not send requests or exchange callbacks', async () => {
  const {api, requests, exchanges} = fixture({configured: false});
  await assert.rejects(api.requestEmailLink('person@example.com'), /接続設定/);
  await assert.rejects(api.acceptAuthCallback(`${callback}?code=test-only`), /接続設定/);
  assert.equal(await api.acceptAuthCallback('haskapp://calendar'), false);
  assert.deepEqual(requests, []);
  assert.deepEqual(exchanges, []);
});

test('Expo Go or web redirects cannot replace the native callback', async () => {
  for (const redirect of ['exp://127.0.0.1:8081/--/auth/callback', 'https://example.com/auth/callback', `${callback}?extra=yes`]) {
    const {api, requests, exchanges} = fixture({redirect});
    assert.throws(() => api.getAuthRedirectUri(), /ネイティブビルド/);
    await assert.rejects(api.requestEmailLink('person@example.com'), /ネイティブビルド/);
    await assert.rejects(api.acceptAuthCallback(`${callback}?code=test-only`), /ネイティブビルド/);
    assert.deepEqual(requests, []);
    assert.deepEqual(exchanges, []);
  }
});

test('provider request errors and exceptions never expose raw details', async () => {
  for (const send of [async () => ({error: new Error('secret@example.com raw-private-detail')}), async () => {throw new Error('raw-private-detail');}]) {
    const {api} = fixture({send});
    await assert.rejects(api.requestEmailLink('person@example.com'), error => {
      assert.match(error.message, /送信できませんでした/);
      assert.doesNotMatch(error.message, /secret|private|example/);
      assert.equal(error.cause, undefined);
      return true;
    });
  }
});

test('only a code on the exact native route reaches PKCE exchange', async () => {
  const {api, exchanges, requests} = fixture();
  assert.equal(await api.acceptAuthCallback(`${callback}?code=test-only-code&next=%2Fdashboard`), true);
  assert.deepEqual(exchanges, ['test-only-code']);
  assert.deepEqual(requests, []);
});

test('unrelated and lookalike links are ignored without authentication side effects', async () => {
  const {api, exchanges} = fixture();
  for (const url of [null, {}, '', 'not a URL', 'https://auth/callback?code=x', 'evil://auth/callback?code=x', 'haskapp://evil/callback?code=x', 'haskapp://auth.evil/callback?code=x', 'haskapp://auth/callback/extra?code=x', 'haskapp:///auth/callback?code=x', 'haskapp://auth/callback.evil?code=x']) {
    assert.equal(await api.acceptAuthCallback(url), false);
  }
  assert.deepEqual(exchanges, []);
});

test('malformed auth callbacks, provider errors and implicit tokens fail safely before exchange', async () => {
  const {api, exchanges} = fixture();
  const urls = [
    callback, `${callback}?code=`, `${callback}?code=one&code=two`, `${callback}?code=%20`,
    `${callback}?code=a%0Ab`, `${callback}?code=%`, `${callback}?code=%FF`,
    `${callback}?code=valid&error=secret`, `${callback}?error_description=raw-private-detail`,
    `${callback}?code=valid&error_code=expired`, `${callback}?access_token=secret&refresh_token=secret`,
    `${callback}?code=valid&token_hash=secret`, `${callback}?code=valid#access_token=secret`,
    `${callback}#code=secret`, 'haskapp://user:secret@auth/callback?code=secret',
    'haskapp://auth:443/callback?code=secret', 'haskapp://auth/path/../callback?code=secret',
    ` ${callback}?code=secret`, `${callback}?code=se\tcret`, `${callback}?code=${'x'.repeat(2049)}`,
  ];
  for (const url of urls) await assert.rejects(api.acceptAuthCallback(url), error => {
    assert.match(error.message, /最新のリンク/);
    assert.doesNotMatch(error.message, /secret|raw-private-detail|access_token|haskapp:\/\//);
    return true;
  });
  assert.deepEqual(exchanges, []);
});

test('failed or empty exchanges are sanitized and a later delivery can retry', async () => {
  let attempts = 0;
  const {api, exchanges} = fixture({exchange: async () => {
    attempts++;
    if (attempts === 1) return {data: {session: null, user: null}, error: new Error('raw-private-code')};
    if (attempts === 2) throw new Error('raw-private-token');
    if (attempts === 3) return {data: {session: null, user: null}, error: null};
    return sessionResult();
  }});
  for (let i = 0; i < 3; i++) await assert.rejects(api.acceptAuthCallback(`${callback}?code=test-only`), error => {
    assert.match(error.message, /最新のリンク/);
    assert.doesNotMatch(error.message, /raw-private/);
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(await api.acceptAuthCallback(`${callback}?code=test-only`), true);
  assert.equal(exchanges.length, 4);
});

test('duplicate cold and runtime callbacks exchange once, including in-flight delivery', async () => {
  let finish;
  const result = new Promise(resolve => {finish = resolve;});
  const {api, exchanges} = fixture({exchange: () => result});
  const first = api.acceptAuthCallback(`${callback}?code=test-only`);
  const second = api.acceptAuthCallback(`${callback}?code=test-only&next=ignored`);
  await Promise.resolve();
  assert.deepEqual(exchanges, ['test-only']);
  finish(sessionResult());
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(await api.acceptAuthCallback(`${callback}?code=test-only`), true);
  assert.deepEqual(exchanges, ['test-only']);
});

test('deduplication is process-local and bounded without retaining all consumed codes', async () => {
  const {api, exchanges} = fixture();
  for (let i = 0; i < 33; i++) assert.equal(await api.acceptAuthCallback(`${callback}?code=test-${i}`), true);
  assert.equal(await api.acceptAuthCallback(`${callback}?code=test-32`), true);
  assert.equal(exchanges.length, 33);
  assert.equal(await api.acceptAuthCallback(`${callback}?code=test-0`), true);
  assert.equal(exchanges.length, 34);
  const restart = fixture();
  assert.equal(await restart.api.acceptAuthCallback(`${callback}?code=test-32`), true);
  assert.equal(restart.exchanges.length, 1);
});
