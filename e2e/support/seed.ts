import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/database.types.ts'
import type { LocalSupabase } from './supabase.ts'

export interface SeededRepositor {
  userId: string
  email: string
  password: string
  fullName: string
  /** Na ordem da rota padrão. */
  marketNames: [string, string]
  /** Cliente de administração, para conferir o que ficou gravado no banco. */
  admin: ReturnType<typeof createClient<Database>>
  cleanup: () => Promise<void>
}

/**
 * Um repositor novo, dois mercados e uma rota padrão para `weekday`. Não cria visitas: quem as
 * gera é o app, ao abrir a tela Hoje, e é justamente isso que o teste quer cobrir.
 * Cada chamada usa nomes únicos, então testes não se atrapalham.
 */
export async function seedRepositor(
  supabase: LocalSupabase,
  weekday: number,
): Promise<SeededRepositor> {
  const admin = createClient<Database>(supabase.apiUrl, supabase.serviceKey, {
    auth: { persistSession: false },
  })
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`
  const email = `e2e-${unique}@test.dev`
  const password = 'senha-de-teste-123'
  const fullName = 'Marina Souza'
  const marketNames: [string, string] = [`Mercado Central ${unique}`, `Mercado Bairro ${unique}`]

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (created.error !== null) throw created.error
  const userId = created.data.user.id

  const markets = await admin
    .from('markets')
    .insert(marketNames.map((name) => ({ name })))
    .select('id, name')
  if (markets.error !== null) throw markets.error
  const marketIds = marketNames.map((name) => {
    const found = markets.data.find((market) => market.name === name)
    if (found === undefined) throw new Error(`mercado ${name} não foi criado`)
    return found.id
  })

  const route = await admin.from('standard_route').insert(
    marketIds.map((marketId, position) => ({
      repositor_id: userId,
      weekday,
      market_id: marketId,
      position,
    })),
  )
  if (route.error !== null) throw route.error

  return {
    userId,
    email,
    password,
    fullName,
    marketNames,
    admin,
    cleanup: async () => {
      await admin.from('visits').delete().eq('repositor_id', userId)
      await admin.from('standard_route').delete().eq('repositor_id', userId)
      await admin.from('markets').delete().in('id', marketIds)
      await admin.auth.admin.deleteUser(userId)
    },
  }
}
