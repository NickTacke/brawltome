import baseConfig from '../../eslint.config.mjs';
import tseslint from 'typescript-eslint';

export default tseslint.config(...baseConfig, {
  files: ['**/*.ts'],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
    },
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-floating-promises': 'warn',
  },
});
