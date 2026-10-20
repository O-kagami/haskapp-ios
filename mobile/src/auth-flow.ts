import {makeRedirectUri} from 'expo-auth-session';
import {CryptoDigestAlgorithm, digestStringAsync} from 'expo-crypto';
import {configured, supabase} from '../web-contract/lib/supabase';

const nativeCallback = 'haskapp://auth/callback';
const callbackFailure = 'ログインを完了できませんでした。この端末でログインリンクを再送し、最新のリンクを開いてください。';
const requestFailure = 'ログインリンクを送信できませんでした。しばらく待ってからもう一度お試しください。';

// iOS can deliver the same callback through both its initial URL and Linking.
// Keep only a bounded set of digests in RAM, never callback URLs or auth codes.
const completedCodes = new Set<string>();
const pendingCodes = new Map<string, Promise<boolean>>();

/** The custom scheme must also be allowed in Supabase's redirect URL settings. */
export function getAuthRedirectUri(): string {
  const redirect = makeRedirectUri({
    scheme: 'haskapp',
    path: 'auth/callback',
    native: nativeCallback,
  });
  // Expo Go cannot own Haskapp's native scheme; do not send links to another app.
  if (redirect !== nativeCallback) throw new Error('ログインにはHaskappのネイティブビルドが必要です。');
  return redirect;
}

/** Same email-link/signup behavior as Web, using the existing PKCE client. */
export async function requestEmailLink(email: string): Promise<void> {
  if (!configured) throw new Error('接続設定が必要です。');
  const trimmed = typeof email === 'string' ? email.trim() : '';
  if (trimmed.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(trimmed)) {
    throw new Error('メールアドレスを確認してください。');
  }
  const emailRedirectTo = getAuthRedirectUri();
  try {
    const {error} = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {emailRedirectTo, shouldCreateUser: true},
    });
    if (error) throw new Error(requestFailure);
  } catch {
    // Upstream error messages may include email addresses or request details.
    throw new Error(requestFailure);
  }
}

/**
 * Returns false for unrelated links, true for an exchanged or duplicate callback.
 * Throws only safe display messages. The caller refreshes account data on true.
 * Supabase verifies the PKCE code against its existing SecureStore verifier and
 * persists the resulting session; this module never stores a URL/code/session.
 */
export async function acceptAuthCallback(url: string): Promise<boolean> {
  if (typeof url !== 'string') return false;
  let callback: URL;
  try { callback = new URL(url); } catch { return false; }
  const expected = new URL(getAuthRedirectUri());
  if (callback.protocol !== expected.protocol || callback.hostname !== expected.hostname || callback.pathname !== expected.pathname) return false;
  if (!configured) throw new Error('接続設定が必要です。');
  // Reject credentials, ports, path normalization, implicit token flows, and
  // fragments rather than ever interpreting them as authenticated sessions.
  if (url.length > 8192 || callback.username || callback.password || callback.port ||
      url.split(/[?#]/, 1)[0] !== nativeCallback || callback.hash ||
      /[\u0000-\u0020\u007f]/.test(url) || /%(?![0-9a-f]{2})/i.test(url)) {
    throw new Error(callbackFailure);
  }
  const params = callback.searchParams;
  if (['error', 'error_code', 'error_description', 'access_token', 'refresh_token', 'token_hash'].some(key => params.has(key))) {
    throw new Error(callbackFailure);
  }
  const codes = params.getAll('code');
  const code = codes[0];
  if (codes.length !== 1 || !code || code.length > 2048 || /[\s\u0000-\u001f\u007f\ufffd]/.test(code)) {
    throw new Error(callbackFailure);
  }

  try {
    const fingerprint = await digestStringAsync(CryptoDigestAlgorithm.SHA256, code);
    if (completedCodes.has(fingerprint)) return true;
    const pending = pendingCodes.get(fingerprint);
    if (pending) return await pending;
    const exchange = (async () => {
      const {data, error} = await supabase.auth.exchangeCodeForSession(code);
      if (error || !data?.session || !data.user) throw new Error(callbackFailure);
      completedCodes.add(fingerprint);
      if (completedCodes.size > 32) completedCodes.delete(completedCodes.values().next().value!);
      return true;
    })();
    pendingCodes.set(fingerprint, exchange);
    try { return await exchange; } finally { pendingCodes.delete(fingerprint); }
  } catch {
    // Never forward a provider error, callback URL, code, or token into UI state.
    throw new Error(callbackFailure);
  }
}
