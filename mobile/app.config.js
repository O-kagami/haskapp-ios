const { resolveBackendConfig } = require('./src/backend-config');

module.exports = ({ config }) => {
  // Fail before prebuild or bundling can expose an accidentally supplied secret.
  resolveBackendConfig(process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, false, process.env.EXPO_PUBLIC_DISABLE_CLOUD === '1');
  return config;
};
