import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'release/**', 'output/**', 'node_modules/**'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      'no-empty': 'error',
      // Legacy backup migration casts are tracked debt; new modules should use unknown/schema types.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
];
