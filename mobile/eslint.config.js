const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
module.exports = defineConfig([expoConfig,{ignores:['ios/**']},{files:['**/*.cjs'],languageOptions:{globals:{__dirname:'readonly',Buffer:'readonly',process:'readonly'}}},{rules:{'@typescript-eslint/no-explicit-any':'off'}}]);
