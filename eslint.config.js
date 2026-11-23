import globals from 'globals';

export default [
  { ignores: ['node_modules/**', 'reference/**', 'test-results/**', 'playwright-report/**'] },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node, chrome: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['src/audio/worklets/**'],
    languageOptions: {
      globals: { AudioWorkletProcessor: 'readonly', registerProcessor: 'readonly', sampleRate: 'readonly', currentFrame: 'readonly', currentTime: 'readonly' },
    },
  },
  { files: ['src/content/**'], languageOptions: { sourceType: 'script' } },
];
