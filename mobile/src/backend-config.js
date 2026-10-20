// Public client settings observed in the live haskapp.foo JavaScript bundle on
// 2026-10-04, tied through Vercel's production alias to Web commit ef1fdba896d6.
// This is a browser-published, unprivileged publishable key, not a server secret.
// See BACKEND-PROVENANCE.md. Do not replace it with a service-role credential.
const DEPLOYED_WEB_BACKEND = Object.freeze({
  url: 'https://rhtowkcsguseruutnqvg.supabase.co',
  key: 'sb_publishable_hT74PHFN_UvLGmYSTVsGBw_gLZrUWy7',
});

// React Native/Hermes does not guarantee a global atob. Keep this small decoder
// dependency-free so build-time Node and the native runtime accept the same keys.
function decodeClaims(encoded) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const raw = encoded.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!raw || /[^A-Za-z0-9+/]/.test(raw) || raw.length % 4 === 1) throw new Error('Invalid key');
  let accumulator = 0; let bits = 0; let escaped = '';
  for (const character of raw) {
    accumulator = (accumulator << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      escaped += '%' + ((accumulator >> bits) & 255).toString(16).padStart(2, '0');
    }
  }
  return JSON.parse(decodeURIComponent(escaped));
}

/**
 * Validate public client configuration. Without an override, use the verified
 * live Web client settings. An explicit override must supply both values.
 * @param {string | undefined} url
 * @param {string | undefined} key
 * @param {boolean} [uiTest]
 * @param {boolean} [disableCloud]
 */
function resolveBackendConfig(url, key, uiTest = false, disableCloud = false) {
  const disabled = { configured: false, url: 'https://unconfigured.invalid', key: 'unconfigured' };
  if (uiTest || disableCloud) return disabled;
  if (!url && !key) { url = DEPLOYED_WEB_BACKEND.url; key = DEPLOYED_WEB_BACKEND.key; }
  if (!url || !key) throw new Error('Both public Supabase settings are required.');
  let endpoint;
  try { endpoint = new URL(url); } catch { throw new Error('Supabase URL must be a valid HTTPS origin.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname)) {
    throw new Error('Supabase URL must be an HTTPS origin without credentials, path, query, or fragment.');
  }
  let isPublic = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!isPublic && key.split('.').length === 3) {
    try {
      const claims = decodeClaims(key.split('.')[1]);
      isPublic = claims.role === 'anon';
    } catch { /* Invalid and secret keys are rejected without including them in errors. */ }
  }
  if (!isPublic) throw new Error('Use a Supabase publishable key or legacy anon key. Secret and service-role keys must never be bundled.');
  return { configured: true, url: endpoint.origin, key };
}
module.exports = { resolveBackendConfig, DEPLOYED_WEB_BACKEND };
