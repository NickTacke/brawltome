// biome formats and lints everything else; it has no rule for blank lines between statements
import stylistic from '@stylistic/eslint-plugin'
import typescriptParser from '@typescript-eslint/parser'

const declarations = ['const', 'let', 'var']
const singleLineDeclarations = ['singleline-const', 'singleline-let', 'singleline-var']
const multiLineStatements = ['multiline-const', 'multiline-let', 'multiline-var', 'multiline-expression']

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/target/**',
      '**/.next/**',
      '**/out/**',
      'research/**',
      'packages/game-data/src/generated/**',
      'packages/contracts/openapi/**',
      'apps/web/next-env.d.ts',
      'apps/desktop/app/gen/**',
    ],
  },
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs,jsx}'],
    languageOptions: { parser: typescriptParser },
    plugins: { '@stylistic': stylistic },
    rules: {
      // functions read in paragraphs: a blank line after guard clauses and blocks, around multi-line
      // steps, after declarations and before return
      '@stylistic/padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: '*', next: 'return' },
        { blankLine: 'always', prev: ['if', 'block-like'], next: '*' },
        { blankLine: 'always', prev: declarations, next: '*' },
        { blankLine: 'any', prev: singleLineDeclarations, next: singleLineDeclarations },
        { blankLine: 'always', prev: '*', next: multiLineStatements },
        { blankLine: 'always', prev: multiLineStatements, next: '*' },
      ],
    },
  },
]
