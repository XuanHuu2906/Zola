import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config(
  { ignores: ['legacy/**', 'dist/**', 'dist-electron/**', 'release/**'] },
  js.configs.recommended, ...tseslint.configs.recommended,
  { rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-control-regex': 'off',
  } },
);
