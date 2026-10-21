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
