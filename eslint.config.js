import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Rules come from docs/code-standards.md section 11.
const PROCESS_ENV = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message: 'Read configuration through the env module (code-standards §10).',
};
const RAW_SQL = {
  selector: "Identifier[name=/^[$](query|execute)Raw(Unsafe)?$/]",
  message: 'Raw SQL is allowed only in the row-lock helper (code-standards §7).',
};
const LITERAL_COLOR = {
  selector: "Literal[value=/(#[0-9a-fA-F]{3,8}|(rgb|hsl)a?[(])/]",
  message: 'Use design tokens, not literal colors (UX Brief §5, §15).',
};

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**', 'docs/**', 'apps/e2e/.auth/**', 'apps/e2e/reports/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': ['error', PROCESS_ENV, RAW_SQL],
    },
  },
  // The env module and tool configs may read process.env.
  {
    files: ['apps/api/src/lib/env.ts', '**/*.config.{js,ts}', 'apps/e2e/**', 'scripts/**'],
    rules: { 'no-restricted-syntax': ['error', RAW_SQL] },
  },
  // The row-lock helper may use raw SQL.
  {
    files: ['apps/api/src/lib/lock.ts'],
    rules: { 'no-restricted-syntax': ['error', PROCESS_ENV] },
  },
  // Web app: browser globals, no direct fetch, no literal colors.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-globals': ['error', { name: 'fetch', message: 'Call the API through lib/api.ts (code-standards §8).' }],
      'no-restricted-syntax': ['error', PROCESS_ENV, RAW_SQL, LITERAL_COLOR],
    },
  },
  { files: ['apps/web/src/lib/api.ts'], rules: { 'no-restricted-globals': 'off' } },
  // Admin area: only the adminQueries repository, no content models (TRD §7.3).
  {
    files: ['apps/api/src/admin/**/*.ts'],
    ignores: ['apps/api/src/admin/admin-queries.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@prisma/client', '**/services/**', '**/jobs/**', '**/lib/db*'], message: 'Admin code may import only adminQueries (TRD §7.3).' },
        ],
      }],
    },
  },
);
