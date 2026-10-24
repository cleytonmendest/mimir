import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/lib/database.types.ts'
import { companyDay } from '../e2e/support/dates.ts'
import { localSupabase } from '../e2e/support/supabase.ts'
import { demoCapacity, storeName, ZONA_SUL_STORES } from './seed-stores.ts'

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
  /** Mercados fictícios de versões antigas do seed: se existirem no banco, saem (com suas reservas e datas fechadas). */
  retiredMarkets: string[]
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

// As lojas onde o seed monta os cenários (dia lotado, dia com vaga, data fechada, reserva cancelada).
// O limite delas é fixo, para os cenários valerem; o das demais sai de demoCapacity.
const LEBLON = 'Loja 07 - Leblon'
const IPANEMA = 'Loja 01 - Ipanema'
const ARNALDO = 'Loja 36 - Arnaldo Quintela'
const BARRA = 'Loja 17 - Barra da Tijuca'
const SCENARIO_CAPACITY = new Map([
  [LEBLON, 3],
  [IPANEMA, 5],
  [ARNALDO, 2],
  [BARRA, 4],
])

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
  markets: ZONA_SUL_STORES.map((store) => ({
    name: storeName(store),
    address: store.address,
    capacity: SCENARIO_CAPACITY.get(storeName(store)) ?? demoCapacity(store),
  })),
  retiredMarkets: [
    'Mercado Central',
    'Supermercado Bela Vista',
    'Mercado do Bairro',
    'Hiper Norte',
  ],
  closedDays: [
    { market: LEBLON, dayOffset: 10, reason: 'Inventário' },
    { market: IPANEMA, dayOffset: 14, reason: 'Feriado municipal' },
    { market: ARNALDO, dayOffset: 4, reason: 'Reforma da loja' },
  ],
  bookings: [
    // Um dia com uma vaga sobrando e um dia lotado, no mesmo mercado.
    { market: LEBLON, supplier: 'fornecedor1@example.com', dayOffset: 2 },
    { market: LEBLON, supplier: 'fornecedor2@example.com', dayOffset: 2 },
    { market: LEBLON, supplier: 'fornecedor1@example.com', dayOffset: 3 },
    { market: LEBLON, supplier: 'fornecedor2@example.com', dayOffset: 3 },
    { market: LEBLON, supplier: 'fornecedor3@example.com', dayOffset: 3 },
    { market: LEBLON, supplier: 'fornecedor4@example.com', dayOffset: 7 },
    { market: IPANEMA, supplier: 'fornecedor5@example.com', dayOffset: 1 },
    { market: IPANEMA, supplier: 'fornecedor1@example.com', dayOffset: 2 },
    { market: IPANEMA, supplier: 'fornecedor3@example.com', dayOffset: 2 },
    { market: IPANEMA, supplier: 'fornecedor6@example.com', dayOffset: 2 },
    { market: IPANEMA, supplier: 'fornecedor7@example.com', dayOffset: 2 },
    { market: IPANEMA, supplier: 'fornecedor2@example.com', dayOffset: 9 },
    { market: ARNALDO, supplier: 'fornecedor4@example.com', dayOffset: 3 },
    { market: ARNALDO, supplier: 'fornecedor8@example.com', dayOffset: 3 },
    { market: ARNALDO, supplier: 'fornecedor5@example.com', dayOffset: 5 },
    { market: BARRA, supplier: 'fornecedor6@example.com', dayOffset: 4 },
    { market: BARRA, supplier: 'fornecedor7@example.com', dayOffset: 4 },
    { market: BARRA, supplier: 'fornecedor1@example.com', dayOffset: 10 },
    { market: BARRA, supplier: 'fornecedor2@example.com', dayOffset: 10 },
    {
      market: BARRA,
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

/**
 * Tira os mercados fictícios de versões antigas do seed (com as reservas e datas fechadas deles). Sem
 * isso, quem já tinha semeado ficaria com eles ao lado das lojas reais, e a lista de mercados, longa e
 * misturada, seria justamente o que o seed existe para mostrar bem.
 */
async function removeRetiredMarkets(db: Db, names: readonly string[]): Promise<void> {
  if (names.length === 0) return
  const found = await db
    .from('markets')
    .select('id')
    .in('name', [...names])
  if (found.error !== null) throw fail('ler mercados antigos', found.error)
  const ids = found.data.map((row) => row.id)
  if (ids.length === 0) return

  const bookings = await db.from('bookings').delete().in('market_id', ids)
  if (bookings.error !== null) throw fail('limpar reservas dos mercados antigos', bookings.error)
  const days = await db.from('closed_days').delete().in('market_id', ids)
  if (days.error !== null) throw fail('limpar datas fechadas dos mercados antigos', days.error)
  const markets = await db.from('markets').delete().in('id', ids)
  if (markets.error !== null) throw fail('apagar mercados antigos', markets.error)
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

  await removeRetiredMarkets(db, plan.retiredMarkets)
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

/**
 * Coluna ou tabela que "não existe" é quase sempre o banco local atrás das migrations (o
 * "supabase start" de um banco que já estava rodando não aplica as novas, por exemplo depois de um
 * git pull). Diz isso e o que fazer, em vez de só repassar o erro do Postgres.
 */
export function explainFailure(message: string): string {
  if (!/does not exist|schema cache|Could not find/i.test(message)) return message
  return (
    `${message}\n\n` +
    'O banco local parece desatualizado (faltam migrations). Rode "npm run db:migrate" e tente de novo. ' +
    'Se não resolver, "npx supabase db reset" recria o banco do zero (ele só tem dados de teste).'
  )
}

/**
 * O servidor de login lê o config.toml só quando o contêiner é criado. Um Supabase local criado numa
 * versão antiga do projeto segue com o login por e-mail desligado (era assim no primeiro commit): o
 * login devolve 422 "Email logins are disabled" e o app só mostra "Não foi possível entrar". O
 * endpoint de configurações do servidor conta isso na hora; devolve o aviso, ou null se está certo.
 */
export function authSettingsProblem(settings: unknown): string | null {
  const external =
    typeof settings === 'object' && settings !== null
      ? (settings as Record<string, unknown>)['external']
      : undefined
  const email =
    typeof external === 'object' && external !== null
      ? (external as Record<string, unknown>)['email']
      : undefined
  if (email !== false) return null
  return (
    'O servidor de login do seu Supabase local foi criado com uma configuração antiga: o login por e-mail ' +
    'está desligado (por isso o app mostra "Não foi possível entrar"). Rode "npx supabase stop" e depois ' +
    '"npm run dev:local": ele recria os contêineres com a configuração atual, e os dados ficam.'
  )
}

/** Pergunta ao servidor de login como ele foi configurado. Sem resposta, não bloqueia: o seed segue. */
async function staleAuthServer(apiUrl: string, anonKey: string): Promise<string | null> {
  try {
    const response = await fetch(`${apiUrl}/auth/v1/settings`, { headers: { apikey: anonKey } })
    if (!response.ok) return null
    const settings: unknown = await response.json()
    return authSettingsProblem(settings)
  } catch {
    return null
  }
}

const ENV_FILE = '.env.local'
const URL_KEY = 'VITE_SUPABASE_URL'
const ANON_KEY = 'VITE_SUPABASE_ANON_KEY'

export interface EnvSync {
  content: string
  /** criado; corrigido (variável vazia, faltando ou apontando para outro lugar); ou já estava certo. */
  change: 'created' | 'fixed' | 'unchanged'
  /** A URL que o arquivo tinha quando era outra que não a local, para avisar de onde ele apontava. */
  previousUrl: string | null
}

/** O valor que o Vite usaria: o da última linha "CHAVE=valor" do arquivo (sem aspas), ou ''. */
function envValue(lines: readonly string[], key: string): string {
  const pattern = new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=\\s*(.*?)\\s*$`)
  let value = ''
  for (const line of lines) {
    const found = pattern.exec(line)
    if (found?.[1] !== undefined) value = found[1].replace(/^(["'])(.*)\1$/, '$2')
  }
  return value
}

/**
 * O .env.local tem de apontar para o Supabase local: é com ele que o app abre. Só existir não basta,
 * a cópia do .env.example fica com a chave vazia e o app pede as variáveis do mesmo jeito. Troca as
 * duas variáveis e deixa o resto do arquivo como está, menos os comentários que citam a chave de
 * servidor (os do .env.example antigo): o guard no-service-role barra o arquivo por causa deles, e o
 * hook de pre-commit roda esse guard.
 */
export function syncEnvFile(existing: string | null, apiUrl: string, anonKey: string): EnvSync {
  const wanted = `${URL_KEY}=${apiUrl}\n${ANON_KEY}=${anonKey}\n`
  if (existing === null) return { content: wanted, change: 'created', previousUrl: null }

  const lines = existing.split(/\r?\n/)
  const currentUrl = envValue(lines, URL_KEY)
  const trips = (line: string) => /^\s*#.*service_role/i.test(line)
  if (
    currentUrl === apiUrl &&
    envValue(lines, ANON_KEY) === anonKey &&
    !lines.some((line) => trips(line))
  ) {
    return { content: existing, change: 'unchanged', previousUrl: null }
  }

  const isOurs = (line: string) =>
    new RegExp(`^\\s*(?:export\\s+)?(?:${URL_KEY}|${ANON_KEY})\\s*=`).test(line)
  const rest = lines.filter((line) => !isOurs(line) && !trips(line))
  while (rest.at(-1)?.trim() === '') rest.pop()
  const kept = rest.length === 0 ? '' : `${rest.join('\n')}\n`
  return {
    content: `${kept}${wanted}`,
    change: 'fixed',
    previousUrl: currentUrl !== '' && currentUrl !== apiUrl ? currentUrl : null,
  }
}

/** Deixa o .env.local apontando para o Supabase local (sem ele, ou com ele errado, o app pede as variáveis). */
function ensureEnvFile(apiUrl: string, anonKey: string): string {
  const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, 'utf8') : null
  const sync = syncEnvFile(existing, apiUrl, anonKey)
  if (sync.change === 'unchanged') return `${ENV_FILE} já aponta para o Supabase local.`

  writeFileSync(ENV_FILE, sync.content)
  const restart = 'Se o "npm run dev" já estava rodando, pare e suba de novo.'
  if (sync.change === 'created') return `${ENV_FILE} criado. ${restart}`
  const before = sync.previousUrl === null ? '' : ` (antes apontava para ${sync.previousUrl})`
  return `${ENV_FILE} corrigido: agora aponta para o Supabase local${before}. ${restart}`
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

  const stale = await staleAuthServer(local.apiUrl, local.anonKey)
  if (stale !== null) {
    console.error(stale)
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
    console.error(explainFailure(error instanceof Error ? error.message : String(error)))
    process.exitCode = 1
  })
}
