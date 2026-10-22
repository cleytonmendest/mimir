import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * "0.0.0+a1b2c3d": a versão do package.json mais o commit do build. Aparece no app, vai ao servidor
 * no cabeçalho X-Client-Info e é o que o suporte pergunta ("qual versão você está usando?").
 */
function appVersion(): string {
  const { version } = JSON.parse(
    readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
  ) as {
    version: string
  }
  let commit = process.env['GITHUB_SHA']?.slice(0, 7)
  if (commit === undefined) {
    try {
      commit = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
    } catch {
      commit = 'dev'
    }
  }
  return `${version}+${commit}`
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts', 'supabase/functions/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // A regra de negócio mora no domínio: ele precisa ficar 100% coberto.
      include: ['src/domain/**/*.ts'],
      exclude: ['src/domain/**/*.test.ts', 'src/domain/testing.ts', 'src/domain/index.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { lines: 100, functions: 100, statements: 100, branches: 100 },
    },
  },
})
