import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import storybook from 'eslint-plugin-storybook'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Fronteiras entre camadas (a ordem é de baixo para cima):
 *   domain         regra de negócio pura: não conhece React, Supabase nem tela
 *   design-system  componentes visuais: conhece o domínio (tipos), não conhece dados nem telas
 *   lib            integração com o mundo (Supabase): único lugar que importa o SDK
 *   features/app   telas: usam as camadas acima
 */
const SDK = { group: ['@supabase/*'], message: 'Só src/lib pode importar o SDK do Supabase.' }
const UP_FROM_DOMAIN = [
  {
    group: ['react', 'react-dom', 'react-dom/*', 'react/*'],
    message: 'O domínio é TypeScript puro, sem React.',
  },
  {
    group: ['@/design-system/*', '@/features/*', '@/lib/*'],
    message: 'O domínio não depende de camadas acima dele.',
  },
  { group: ['../*'], message: 'O domínio é plano: use ./arquivo.' },
  SDK,
]
const UP_FROM_DESIGN_SYSTEM = [
  { group: ['@/features/*', '@/lib/*'], message: 'O design system não conhece dados nem telas.' },
  SDK,
]

const COLOR_LITERAL = [
  {
    selector: 'Literal[value=/#[0-9a-fA-F]{3,8}\\b/]',
    message: 'Cor fixa no código. Use um token de src/design-system/tokens.css.',
  },
  {
    selector: 'Literal[value=/\\b(rgb|rgba|hsl|hsla|oklch)\\(/]',
    message: 'Cor fixa no código. Use um token de src/design-system/tokens.css.',
  },
]

export default defineConfig([
  globalIgnores([
    'dist',
    'coverage',
    'storybook-static',
    'playwright-report',
    'test-results',
    // Pontos de entrada do Deno (Deno.serve): três linhas cada, cobertos pelo E2E. A lógica fica em
    // supabase/functions/_shared, que é lintada e testada.
    'supabase/functions/*/index.ts',
    'src/lib/database.types.ts',
  ]),

  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-imports': ['error', { patterns: [SDK] }],
      'no-restricted-syntax': ['error', ...COLOR_LITERAL],
    },
  },
  {
    files: ['src/domain/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: UP_FROM_DOMAIN }] },
  },
  {
    files: ['src/design-system/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': ['error', { patterns: UP_FROM_DESIGN_SYSTEM }] },
  },
  {
    // Componentes copiados pelo `shadcn add`: exportam as variantes (cva) junto do componente.
    files: ['src/design-system/components/ui/**/*.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  { files: ['src/lib/**/*.ts'], rules: { 'no-restricted-imports': 'off' } },

  // Testes e stories: mesmas fronteiras, menos rigor de tipos nos matchers do Vitest.
  {
    files: ['**/*.{test,spec}.{ts,tsx}', '**/*.stories.tsx'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },

  {
    files: [
      '.storybook/**/*.ts',
      'e2e/**/*.ts',
      'scripts/**/*.ts',
      'supabase/functions/**/*.ts',
      '*.config.{ts,js}',
    ],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },

  storybook.configs['flat/recommended'],
])
