import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // .only esquecido não pode chegar ao CI.
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
  // O usuário real usa o celular, dentro de mercado.
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env['CI'],
  },
})
