import { existsSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/lib/database.types.ts'
import { companyDay } from '../e2e/support/dates.ts'
import { localSupabase } from '../e2e/support/supabase.ts'

const NOT_RUNNING =
  'Não achei o Supabase local rodando. Abra o Docker e rode "npm run dev:local" (sobe o banco, cria os dados de teste e abre o app), ou só "npm run db:start" antes deste comando.'

/**
 * Dados de mentira para trabalhar no app em máquina de desenvolvimento: um administrador com
 * e-mail e senha fáceis de lembrar, fornecedores fictícios, mercados, datas fechadas e reservas.
 *
 *   npm run db:seed-dev
 *
 * SÓ roda contra o Supabase local (o do "npm run db:start"). Qualquer outro endereço é recusado
 * antes de qualquer escrita: estas senhas são públicas, escritas aqui, e nunca podem existir num
 * banco de verdade. Rodar de novo é seguro: as contas são reaproveitadas (e a senha volta ao que
 * está aqui) e as reservas e datas fechadas dos mercados abaixo são refeitas a partir de hoje.
 */

export const ADMIN_PASSWORD = 'admin12345'
export const SUPPLIER_PASSWORD = 'senha12345'

export interface SeedUser {
  email: string
  fullName: string
  password: string
  role: 'admin' | 'supplier'
  /** false: a conta existe mas está desativada (para ver essa tela). */
  active: boolean
}

export interface SeedMarket {
  name: string
  address: string
  capacity: number
}

/** Datas como "daqui a N dias" (a partir de hoje, no fuso da empresa), para o cenário nunca envelhecer. */
export interface SeedClosedDay {
  market: string
  dayOffset: number
  reason: string
}

export interface SeedBooking {
  market: string
  /** E-mail do fornecedor. */
  supplier: string
  dayOffset: number
  /** Reserva já cancelada pelo administrador, com o motivo. */
  cancelledReason?: string
}

export interface SeedPlan {
  users: SeedUser[]
  markets: SeedMarket[]
  closedDays: SeedClosedDay[]
  bookings: SeedBooking[]
}

const supplier = (number: number, fullName: string, active = true): SeedUser => ({
  email: `fornecedor${number}@example.com`,
  fullName,
  password: SUPPLIER_PASSWORD,
  role: 'supplier',
  active,
})

const CENTRAL = 'Mercado Central'
const BELA_VISTA = 'Supermercado Bela Vista'
const BAIRRO = 'Mercado do Bairro'
const NORTE = 'Hiper Norte'

export const SEED_PLAN: SeedPlan = {
  users: [
    {
      email: 'admin@admin.com',
      fullName: 'Dono dos Mercados',
      password: ADMIN_PASSWORD,
      role: 'admin',
      active: true,
    },
    supplier(1, 'Laticínios Serra Azul'),
    supplier(2, 'Doces da Vovó Lia'),
    supplier(3, 'Café Montanha'),
    supplier(4, 'Queijos do Vale'),
    supplier(5, 'Bebidas Fonte Viva'),
    supplier(6, 'Biscoitos Dona Cida'),
    supplier(7, 'Azeites Oliveira'),
    supplier(8, 'Massas da Nonna'),
    supplier(9, 'Frios Antigos Ltda (desativado)', false),
  ],
  markets: [
    { name: CENTRAL, address: 'Rua das Flores, 120 - Centro', capacity: 3 },
    { name: BELA_VISTA, address: 'Av. Brasil, 2400 - Bela Vista', capacity: 5 },
    { name: BAIRRO, address: 'Rua do Comércio, 45 - Jardim das Acácias', capacity: 2 },
    { name: NORTE, address: 'Rodovia BR-101, km 12 - Zona Norte', capacity: 4 },
  ],
  closedDays: [
    { market: CENTRAL, dayOffset: 10, reason: 'Inventário' },
    { market: BELA_VISTA, dayOffset: 14, reason: 'Feriado municipal' },
    { market: BAIRRO, dayOffset: 4, reason: 'Reforma da loja' },
  ],
  bookings: [
    // Um dia com uma vaga sobrando e um dia lotado, no mesmo mercado.
    { market: CENTRAL, supplier: 'fornecedor1@example.com', dayOffset: 2 },
    { market: CENTRAL, supplier: 'fornecedor2@example.com', dayOffset: 2 },
    { market: CENTRAL, supplier: 'fornecedor1@example.com', dayOffset: 3 },
    { market: CENTRAL, supplier: 'fornecedor2@example.com', dayOffset: 3 },
    { market: CENTRAL, supplier: 'fornecedor3@example.com', dayOffset: 3 },
    { market: CENTRAL, supplier: 'fornecedor4@example.com', dayOffset: 7 },
    { market: BELA_VISTA, supplier: 'fornecedor5@example.com', dayOffset: 1 },
    { market: BELA_VISTA, supplier: 'fornecedor1@example.com', dayOffset: 2 },
    { market: BELA_VISTA, supplier: 'fornecedor3@example.com', dayOffset: 2 },
    { market: BELA_VISTA, supplier: 'fornecedor6@example.com', dayOffset: 2 },
    { market: BELA_VISTA, supplier: 'fornecedor7@example.com', dayOffset: 2 },
    { market: BELA_VISTA, supplier: 'fornecedor2@example.com', dayOffset: 9 },
    { market: BAIRRO, supplier: 'fornecedor4@example.com', dayOffset: 3 },
    { market: BAIRRO, supplier: 'fornecedor8@example.com', dayOffset: 3 },
    { market: BAIRRO, supplier: 'fornecedor5@example.com', dayOffset: 5 },
    { market: NORTE, supplier: 'fornecedor6@example.com', dayOffset: 4 },
    { market: NORTE, supplier: 'fornecedor7@example.com', dayOffset: 4 },
    { market: NORTE, supplier: 'fornecedor1@example.com', dayOffset: 10 },
    { market: NORTE, supplier: 'fornecedor2@example.com', dayOffset: 10 },
    {
      market: NORTE,
      supplier: 'fornecedor3@example.com',
      dayOffset: 6,
      cancelledReason: 'Pedido do fornecedor',
    },
  ],
}

// ---------------------------------------------------------------- trava: só o Supabase local

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** O emissor do JWT. Todo Supabase local usa o mesmo, "supabase-demo"; um projeto de verdade, não. */
function issuerOf(jwt: string): string | null {
  const payload = jwt.split('.')[1]
  if (payload === undefined) return null
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    const issuer =
      typeof claims === 'object' && claims !== null
        ? (claims as Record<string, unknown>)['iss']
        : undefined
    return typeof issuer === 'string' ? issuer : null
  } catch {
    return null
  }
}

/**
 * Duas conferências independentes, porque errar aqui põe senha pública num banco de verdade: o
 * endereço tem de ser desta máquina e a chave de serviço tem de ser a do Supabase local.
 * Devolve a recusa, ou null se pode seguir.
 */
export function refuseNonLocal(apiUrl: string, serviceKey: string): string | null {
  let host: string
  try {
    host = new URL(apiUrl).hostname
  } catch {
    return `Recusado: "${apiUrl}" não é um endereço válido.`
  }
  if (!LOCAL_HOSTS.has(host)) {
    return `Recusado: ${host} não é o Supabase local. Este seed só roda em 127.0.0.1 ou localhost.`
  }
  if (issuerOf(serviceKey) !== 'supabase-demo') {
    return 'Recusado: a chave de serviço não é a do Supabase local (o seed nunca roda com chave de um projeto de verdade).'
  }
  return null
}

// ---------------------------------------------------------------- execução

type Db = ReturnType<typeof createClient<Database>>

function fail(step: string, error: { message: string }): Error {
  return new Error(`${step}: ${error.message}`)
}

async function ensureUser(db: Db, user: SeedUser): Promise<string> {
  const userMetadata = { full_name: user.fullName }
  const created = await db.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
    user_metadata: userMetadata,
  })

  let id: string
  if (created.error === null) {
    id = created.data.user.id
  } else if (created.error.code === 'email_exists') {
    const found = await db.from('profiles').select('id').eq('email', user.email).single()
    if (found.error !== null) throw fail(`achar ${user.email}`, found.error)
    id = found.data.id
    const refreshed = await db.auth.admin.updateUserById(id, {
      password: user.password,
      email_confirm: true,
      user_metadata: userMetadata,
    })
    if (refreshed.error !== null) throw fail(`atualizar ${user.email}`, refreshed.error)
  } else {
    throw fail(`criar ${user.email}`, created.error)
  }

  // Toda conta nasce fornecedora e ativa; papel e desativação mudam aqui, com a chave de serviço.
  const profile = await db
    .from('profiles')
    .update({
      role: user.role,
      full_name: user.fullName,
      deactivated_at: user.active ? null : new Date().toISOString(),
    })
    .eq('id', id)
  if (profile.error !== null) throw fail(`perfil de ${user.email}`, profile.error)
  return id
}

async function ensureMarkets(db: Db, markets: readonly SeedMarket[]): Promise<Map<string, string>> {
  const existing = await db
    .from('markets')
    .select('id, name')
    .in(
      'name',
      markets.map((market) => market.name),
    )
  if (existing.error !== null) throw fail('ler mercados', existing.error)

  const ids = new Map<string, string>()
  for (const market of markets) {
    const row = { name: market.name, address: market.address, capacity: market.capacity }
    const found = existing.data.find((candidate) => candidate.name === market.name)
    if (found === undefined) {
      const inserted = await db.from('markets').insert(row).select('id').single()
      if (inserted.error !== null) throw fail(`criar ${market.name}`, inserted.error)
      ids.set(market.name, inserted.data.id)
    } else {
      const updated = await db
        .from('markets')
        .update({ ...row, archived_at: null })
        .eq('id', found.id)
      if (updated.error !== null) throw fail(`atualizar ${market.name}`, updated.error)
      ids.set(market.name, found.id)
    }
  }
  return ids
}

export interface SeedSummary {
  users: number
  markets: number
  closedDays: number
  bookings: number
}

export async function runSeed(db: Db, plan: SeedPlan): Promise<SeedSummary> {
  const userIds = new Map<string, string>()
  for (const user of plan.users) userIds.set(user.email, await ensureUser(db, user))
  const adminId = userIds.get(plan.users.find((user) => user.role === 'admin')?.email ?? '')
  if (adminId === undefined) throw new Error('O plano do seed precisa de um administrador.')

  const marketIds = await ensureMarkets(db, plan.markets)
  const marketIdList = [...marketIds.values()]

  // Refaz o cenário: o que estava reservado ou fechado nesses mercados sai, o que o plano diz entra.
  const clearedBookings = await db.from('bookings').delete().in('market_id', marketIdList)
  if (clearedBookings.error !== null) throw fail('limpar reservas', clearedBookings.error)
  const clearedDays = await db.from('closed_days').delete().in('market_id', marketIdList)
  if (clearedDays.error !== null) throw fail('limpar datas fechadas', clearedDays.error)

  const idOf = (map: Map<string, string>, key: string, what: string): string => {
    const id = map.get(key)
    if (id === undefined) throw new Error(`O plano do seed cita ${what} que não existe: ${key}`)
    return id
  }

  const closedDays = plan.closedDays.map((closed) => ({
    market_id: idOf(marketIds, closed.market, 'o mercado'),
    day: companyDay(closed.dayOffset),
    reason: closed.reason,
  }))
  const closed = await db.from('closed_days').insert(closedDays)
  if (closed.error !== null) throw fail('datas fechadas', closed.error)

  const cancelledAt = new Date().toISOString()
  const bookings = plan.bookings.map((booking) => ({
    market_id: idOf(marketIds, booking.market, 'o mercado'),
    supplier_id: idOf(userIds, booking.supplier, 'o fornecedor'),
    day: companyDay(booking.dayOffset),
    ...(booking.cancelledReason === undefined
      ? {}
      : {
          cancelled_at: cancelledAt,
          cancelled_by: adminId,
          cancel_reason: booking.cancelledReason,
        }),
  }))
  const booked = await db.from('bookings').insert(bookings)
  if (booked.error !== null) throw fail('reservas', booked.error)

  return {
    users: plan.users.length,
    markets: plan.markets.length,
    closedDays: closedDays.length,
    bookings: bookings.length,
  }
}

// ---------------------------------------------------------------- linha de comando

/** Cria o .env.local que o app precisa, se ainda não existir (sem ele o app abre pedindo isso). */
function ensureEnvFile(apiUrl: string, anonKey: string): string {
  const file = '.env.local'
  if (existsSync(file)) return `${file} já existe, não mexi.`
  writeFileSync(file, `VITE_SUPABASE_URL=${apiUrl}\nVITE_SUPABASE_ANON_KEY=${anonKey}\n`)
  return `${file} criado (se o "npm run dev" já estava rodando, pare e suba de novo).`
}

async function main(): Promise<void> {
  const local = localSupabase()
  if (local === null) {
    console.error(NOT_RUNNING)
    process.exitCode = 1
    return
  }
  const refusal = refuseNonLocal(local.apiUrl, local.serviceKey)
  if (refusal !== null) {
    console.error(refusal)
    process.exitCode = 1
    return
  }

  const db = createClient<Database>(local.apiUrl, local.serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const summary = await runSeed(db, SEED_PLAN)

  console.log(
    `Pronto: ${summary.users} contas, ${summary.markets} mercados, ${summary.closedDays} datas fechadas e ${summary.bookings} reservas.\n\n` +
      'Entre no app com:\n' +
      `  administrador  admin@admin.com          senha ${ADMIN_PASSWORD}\n` +
      `  fornecedores   fornecedor1@example.com  senha ${SUPPLIER_PASSWORD}  (até fornecedor8; o 9 está desativado)\n\n` +
      `${ensureEnvFile(local.apiUrl, local.anonKey)}\n` +
      'Rodar de novo refaz as reservas e as datas fechadas desses mercados a partir de hoje.',
  )
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
