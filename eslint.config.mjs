// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/out/**',
      '**/coverage/**',
      '**/dist-types/**',
      '**/release/**',
      '**/.vercel/**',
      'apps/mobile/ios/**',
      'apps/mobile/android/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.agents/**',
      '.claude/**',
      'scrollcraft/**',
      /*
       * The Scroll Craft engine, vendored verbatim.
       *
       * `apps/web/src/public/scrollcraft.js` is a byte-for-byte copy of the skill's
       * `engine/scrollcraft.js`. It is the mechanism the public experience is built on and it is
       * never edited per project — a lint fix here would fork it, and the fork would drift. A
       * unit test asserts the copy still matches the source, which is a stronger guarantee than
       * a style rule.
       */
      'apps/web/src/public/scrollcraft.js',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
);
