// SPDX-License-Identifier: AGPL-3.0-or-later
import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', '.cache/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      // `catch (_) {}` marks a failure that is fine to ignore, e.g. storage a
      // private window refuses.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { caughtErrors: 'none', argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['build.mjs', 'eslint.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node } },
  },
];
