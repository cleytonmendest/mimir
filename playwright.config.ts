import { defineConfig, devices } from '@playwright/test'
import { localSupabase } from './e2e/support/supabase.ts'

// Sem Supabase local o app abre e avisa que falta configuração; só os testes que usam banco falham.
const supabase = localSupabase()

export default defineConfig({
  testDir: './e2e',
  // .only esquecido não pode chegar ao CI.
  forbidOnly: !!process.env['CI'],
  // Os testes de acesso mexem em estado global do banco (modo de cadastro, limite de tentativas):
  // dois arquivos ao mesmo tempo se atrapalhariam. A suíte é pequena, então um worker basta.
  workers: 1,
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: 'http://localhost:5173', trace: 'on-first-retry' },
  // O usuário real usa o celular, dentro de mercado.
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    // Atenção: um "npm run dev" já aberto sem as variáveis do Supabase seria reaproveitado e o login falharia.
    reuseExistingServer: !process.env['CI'],
    env:
      supabase === null
        ? {}
        : { VITE_SUPABASE_URL: supabase.apiUrl, VITE_SUPABASE_ANON_KEY: supabase.anonKey },
  },
})
