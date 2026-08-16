// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  // The docs site has its own toolchain and its own manifest; its build output
  // and dependencies are not this project's source.
  {
    ignores: [
      'dist/',
      'coverage/',
      'docs/.vitepress/dist/',
      'docs/.vitepress/cache/',
      'docs/node_modules/',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  }
);
