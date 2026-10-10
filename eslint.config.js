// ESLint: catches typos, undefined names and dead code before they ship. No build step; these are checks only.
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', 'tests/e2e/out/**', 'worker/discord-feed.js'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-useless-assignment': 'off', // flags harmless starting values like `let ok = false` before a try
    },
  },
  {
    // The app: classic browser scripts that share globals between files (each file lists what it uses in /* global */).
    files: ['*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'script', globals: { ...globals.browser, module: 'readonly', require: 'readonly' } },
    // Top-level names are shared with the other scripts, so only local variables count as unused.
    rules: { 'no-unused-vars': ['error', { vars: 'local', args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }] },
  },
  { files: ['eslint.config.js'], languageOptions: { sourceType: 'commonjs', globals: globals.node } },
  { files: ['worker/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node, ...globals.worker, window: 'readonly' } } },
  { files: ['worker/**/*.mjs'], languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: globals.worker } },
  { files: ['tests/**/*.js'], languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: globals.node } },
  // Browser tests run code inside the page (page.evaluate), where the app's globals exist but ESLint can't see them.
  { files: ['tests/e2e/**/*.js'], languageOptions: { globals: { ...globals.node, ...globals.browser } }, rules: { 'no-undef': 'off' } },
];
