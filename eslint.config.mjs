import nx from '@nx/eslint-plugin';
import jsoncParser from 'jsonc-eslint-parser';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/out-tsc'],
  },
  {
    files: ['**/package.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          checkMissingDependencies: true,
          checkObsoleteDependencies: false,
          checkVersionMismatches: true,
          ignoredFiles: [
            '{projectRoot}/**/*.test.ts',
            '{projectRoot}/**/*.spec.ts',
            '{projectRoot}/**/*.test.tsx',
            '{projectRoot}/**/*.spec.tsx',
            '{projectRoot}/eslint.config.*',
            '{projectRoot}/next.config.*',
            '{projectRoot}/webpack.config.*',
            '{projectRoot}/postcss.config.*',
            '{projectRoot}/tailwind.config.*',
            '{projectRoot}/prisma.config.*',
          ],
          ignoredDependencies: [
            'vitest',
            '@vitest/coverage-v8',
            '@nx/webpack',
            '@nx/next',
            '@nx/eslint-plugin',
            '@next/eslint-plugin-next',
          ],
        },
      ],
    },
    languageOptions: {
      parser: jsoncParser,
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
];
