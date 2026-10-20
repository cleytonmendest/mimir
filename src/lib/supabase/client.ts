import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/database.types'
import { ConfigError } from './errors'

/**
 * ÚNICO arquivo que cria o cliente do SDK do Supabase (o ESLint barra o SDK fora de src/lib).
 * Só a chave pública existe no front. A chave secreta de servidor NUNCA entra aqui:
 * o guard "no-service-role" derruba o CI se ela aparecer em src/.
 */
export type AppSupabaseClient = SupabaseClient<Database>

let client: AppSupabaseClient | undefined

/**
 * Criado na primeira vez que alguém usa, e não ao importar: sem .env o app ainda abre e
 * explica o que falta, em vez de ficar em branco.
 */
export function getSupabase(): AppSupabaseClient {
  if (client !== undefined) return client

  const url = import.meta.env.VITE_SUPABASE_URL
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (url === undefined || url.trim() === '' || anonKey === undefined || anonKey.trim() === '') {
    throw new ConfigError('Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja .env.example)')
  }

  client = createClient<Database>(url, anonKey)
  return client
}
