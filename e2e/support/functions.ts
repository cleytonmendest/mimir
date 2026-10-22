import { createClient } from '@supabase/supabase-js'
import type { Database } from '../../src/lib/database.types.ts'
import type { SeededUsers } from './seed.ts'
import type { LocalSupabase } from './supabase.ts'

export interface FunctionReply {
  status: number
  body: Record<string, unknown>
  headers: Headers
}

/** Chama uma Edge Function como o navegador chamaria: chave pública e, se houver, o login. */
export async function callFunction(
  supabase: LocalSupabase,
  name: string,
  options: { token?: string; body?: unknown; method?: string } = {},
): Promise<FunctionReply> {
  const response = await fetch(`${supabase.apiUrl}/functions/v1/${name}`, {
    method: options.method ?? 'POST',
    headers: {
      apikey: supabase.anonKey,
      Authorization: `Bearer ${options.token ?? supabase.anonKey}`,
      'Content-Type': 'application/json',
    },
    ...(options.method === 'OPTIONS' ? {} : { body: JSON.stringify(options.body ?? {}) }),
  })
  const text = await response.text()
  return {
    status: response.status,
    body: text === '' ? {} : (JSON.parse(text) as Record<string, unknown>),
    headers: response.headers,
  }
}

/** Um cliente com a chave pública, como o app, já logado (ou não) como alguém. */
export async function clientFor(
  supabase: LocalSupabase,
  credentials?: { email: string; password: string },
) {
  const client = createClient<Database>(supabase.apiUrl, supabase.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  if (credentials !== undefined) {
    const signedIn = await client.auth.signInWithPassword(credentials)
    if (signedIn.error !== null) throw signedIn.error
  }
  return client
}

export async function accessTokenFor(
  supabase: LocalSupabase,
  credentials: { email: string; password: string },
): Promise<string> {
  const client = await clientFor(supabase, credentials)
  const { data } = await client.auth.getSession()
  if (data.session === null) throw new Error('sem sessão')
  return data.session.access_token
}

/** Volta o cadastro público ao padrão (fechado, sem código) e zera o limite de tentativas. */
export async function resetSignupState(db: SeededUsers['db']): Promise<void> {
  await db.from('signup_attempts').delete().gte('id', 0)
  const reset = await db
    .from('signup_settings')
    .update({ mode: 'closed', invite_code: null, updated_by: null })
    .eq('singleton', true)
  if (reset.error !== null) throw reset.error
}

/** Apaga contas criadas pelos testes (pelo e-mail, que é o que o cadastro público devolve). */
export async function deleteUsersByEmail(db: SeededUsers['db'], emails: readonly string[]) {
  for (const email of emails) {
    const profile = await db.from('profiles').select('id').eq('email', email).maybeSingle()
    if (profile.data !== null) {
      await db.from('bookings').delete().eq('supplier_id', profile.data.id)
      await db.auth.admin.deleteUser(profile.data.id)
    }
  }
}

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@test.dev`
}
