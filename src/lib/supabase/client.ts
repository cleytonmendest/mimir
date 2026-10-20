import { createClient } from '@supabase/supabase-js'

/**
 * ÚNICO arquivo que importa o SDK do Supabase (o ESLint barra o resto do código).
 * Só a chave pública existe no front. A chave secreta de servidor NUNCA entra aqui:
 * o guard "no-service-role" derruba o CI se ela aparecer em src/.
 */
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (typeof url !== 'string' || typeof anonKey !== 'string') {
  throw new Error('Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja .env.example)')
}

export const supabase = createClient(url, anonKey)
