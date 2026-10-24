import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/database.types.ts'
import type { LocalSupabase } from './supabase.ts'

export interface SeededUser {
  userId: string
  email: string
  password: string
  fullName: string
}

export interface SeededUsers {
  admin: SeededUser
  supplier: SeededUser
  /** Cliente de administração, para conferir o que ficou gravado no banco. */
  db: ReturnType<typeof createClient<Database>>
  cleanup: () => Promise<void>
}

/**
 * Um administrador e um fornecedor novos. Cada chamada usa e-mails únicos, então testes não se
 * atrapalham. Toda conta nasce fornecedora (o papel nunca vem do cadastro); o admin é promovido
 * aqui, com a chave de serviço, como o script de primeiro acesso fará.
 */
export async function seedUsers(supabase: LocalSupabase): Promise<SeededUsers> {
  const db = createClient<Database>(supabase.apiUrl, supabase.serviceKey, {
    auth: { persistSession: false },
  })
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`

  async function createUser(prefix: string, fullName: string): Promise<SeededUser> {
    const email = `${prefix}-${unique}@test.dev`
    const password = 'senha-de-teste-123'
    const created = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    })
    if (created.error !== null) throw created.error
    return { userId: created.data.user.id, email, password, fullName }
  }

  const supplier = await createUser('fornecedor', 'Sabor da Serra')
  const admin = await createUser('admin', 'Lia Prado')
  const promoted = await db.from('profiles').update({ role: 'admin' }).eq('id', admin.userId)
  if (promoted.error !== null) throw promoted.error

  return {
    admin,
    supplier,
    db,
    cleanup: async () => {
      await db.auth.admin.deleteUser(admin.userId)
      await db.auth.admin.deleteUser(supplier.userId)
    },
  }
}

export interface SeededSupplier extends SeededUser {
  /** Cliente já logado como esse fornecedor, com a chave pública, como o app. */
  client: ReturnType<typeof createClient<Database>>
}

/** Um mercado novo (nome único) com o limite pedido e, se quiser, o endereço. */
export async function createMarket(
  db: SeededUsers['db'],
  capacity: number,
  name = 'Mercado de teste',
  address: string | null = null,
): Promise<{ id: string; name: string }> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`
  const fullName = `${name} ${unique}`
  const created = await db
    .from('markets')
    .insert({ name: fullName, capacity, address })
    .select('id')
    .single()
  if (created.error !== null) throw created.error
  return { id: created.data.id, name: fullName }
}

/** `count` fornecedores novos, cada um já logado em um cliente próprio. */
export async function createSuppliers(
  supabase: LocalSupabase,
  db: SeededUsers['db'],
  count: number,
): Promise<SeededSupplier[]> {
  const unique = `${Date.now()}-${Math.floor(Math.random() * 10_000)}`
  return Promise.all(
    Array.from({ length: count }, async (_, index) => {
      const email = `forn${index}-${unique}@test.dev`
      const password = 'senha-de-teste-123'
      const fullName = `Fornecedor ${index}`
      const created = await db.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
      })
      if (created.error !== null) throw created.error
      const client = createClient<Database>(supabase.apiUrl, supabase.anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const signedIn = await client.auth.signInWithPassword({ email, password })
      if (signedIn.error !== null) throw signedIn.error
      return { userId: created.data.user.id, email, password, fullName, client }
    }),
  )
}

/** Apaga o que os testes de reserva criaram (reservas primeiro: o histórico não deixa apagar a conta). */
export async function cleanupBooking(
  db: SeededUsers['db'],
  marketId: string,
  suppliers: readonly { userId: string }[],
): Promise<void> {
  await db.from('bookings').delete().eq('market_id', marketId)
  await db.from('closed_days').delete().eq('market_id', marketId)
  await db.from('markets').delete().eq('id', marketId)
  await Promise.all(suppliers.map((supplier) => db.auth.admin.deleteUser(supplier.userId)))
}
