import { describe, expect, it } from 'vitest'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../src/domain/access.ts'
import { explainFailure, refuseNonLocal, SEED_PLAN, syncEnvFile } from './seed-dev.ts'

// Espelha BOOKING_WINDOW_DAYS (src/domain/booking.ts). Não dá para importar de lá: os imports
// internos do domínio não têm extensão, e os scripts rodam direto no Node. Se mudar, só o realismo
// do cenário muda: o seed grava com a chave de serviço e não passa pela regra da janela.
const BOOKING_WINDOW_DAYS = 60

function jwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${part({ alg: 'HS256', typ: 'JWT' })}.${part(claims)}.assinatura`
}

const LOCAL_SERVICE_KEY = jwt({ iss: 'supabase-demo', role: 'service_role' })

describe('refuseNonLocal', () => {
  it('deixa seguir só com endereço local e a chave do Supabase local', () => {
    for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321']) {
      expect(refuseNonLocal(url, LOCAL_SERVICE_KEY)).toBeNull()
    }
  })

  it('recusa um projeto de verdade, mesmo com a chave local', () => {
    expect(refuseNonLocal('https://abcd.supabase.co', LOCAL_SERVICE_KEY)).toMatch(
      /não é o Supabase local/,
    )
    expect(refuseNonLocal('http://192.168.0.10:54321', LOCAL_SERVICE_KEY)).toMatch(
      /não é o Supabase local/,
    )
  })

  it('recusa endereço local com chave de outro projeto (túnel para produção)', () => {
    const production = jwt({ iss: 'supabase', ref: 'abcd', role: 'service_role' })
    expect(refuseNonLocal('http://127.0.0.1:54321', production)).toMatch(/chave de serviço/)
  })

  it('recusa o que não dá para entender', () => {
    expect(refuseNonLocal('isto não é uma url', LOCAL_SERVICE_KEY)).toMatch(/endereço válido/)
    expect(refuseNonLocal('http://127.0.0.1:54321', 'sb_secret_qualquercoisa')).toMatch(
      /chave de serviço/,
    )
    expect(refuseNonLocal('http://127.0.0.1:54321', 'a.%%%.c')).toMatch(/chave de serviço/)
    expect(refuseNonLocal('http://127.0.0.1:54321', '')).toMatch(/chave de serviço/)
  })
})

describe('explainFailure', () => {
  it('explica o banco desatualizado (coluna ou tabela que não existe) e diz o que rodar', () => {
    for (const message of [
      'achar admin@admin.com: column profiles.email does not exist',
      "reservas: Could not find the table 'public.bookings' in the schema cache",
    ]) {
      const explained = explainFailure(message)
      expect(explained).toContain(message)
      expect(explained).toContain('npm run db:migrate')
      expect(explained).toContain('npx supabase db reset')
    }
  })

  it('deixa qualquer outro erro como veio', () => {
    expect(explainFailure('criar admin@admin.com: Database error')).toBe(
      'criar admin@admin.com: Database error',
    )
  })
})

describe('syncEnvFile', () => {
  const url = 'http://127.0.0.1:54321'
  const key = 'chave-anon-local'
  const wanted = `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\n`

  it('cria o arquivo quando ele não existe', () => {
    expect(syncEnvFile(null, url, key)).toEqual({
      content: wanted,
      change: 'created',
      previousUrl: null,
    })
  })

  it('conserta a cópia do .env.example, que fica com a chave vazia e deixa o app pedindo as variáveis', () => {
    const example = [
      '# Local: "npm run db:start"',
      '# Copie este arquivo para .env.local; ele não é versionado.',
      `VITE_SUPABASE_URL=${url}`,
      '# Chave pública. NUNCA colocar a service_role aqui.',
      'VITE_SUPABASE_ANON_KEY=',
      '',
    ].join('\n')

    const result = syncEnvFile(example, url, key)

    expect(result.change).toBe('fixed')
    expect(result.previousUrl).toBeNull()
    expect(result.content).toBe(
      [
        '# Local: "npm run db:start"',
        '# Copie este arquivo para .env.local; ele não é versionado.',
        wanted.trimEnd(),
        '',
      ].join('\n'),
    )
  })

  it('traz de volta ao local um arquivo que apontava para outro projeto, avisando para onde apontava', () => {
    const elsewhere = 'VITE_SUPABASE_URL=https://abcd.supabase.co\nVITE_SUPABASE_ANON_KEY=outra\n'
    const result = syncEnvFile(elsewhere, url, key)
    expect(result).toEqual({
      content: wanted,
      change: 'fixed',
      previousUrl: 'https://abcd.supabase.co',
    })
  })

  it('não mexe no que já está certo, mesmo com aspas, export ou outras variáveis no arquivo', () => {
    for (const existing of [
      wanted,
      `VITE_SUPABASE_URL="${url}"\nVITE_SUPABASE_ANON_KEY='${key}'\n`,
      `export VITE_SUPABASE_URL=${url}\nexport VITE_SUPABASE_ANON_KEY=${key}\nOUTRA=1\n`,
      `VITE_SUPABASE_URL=${url}\r\nVITE_SUPABASE_ANON_KEY=${key}\r\n`,
    ]) {
      expect(syncEnvFile(existing, url, key)).toEqual({
        content: existing,
        change: 'unchanged',
        previousUrl: null,
      })
    }
  })

  it('guarda as outras variáveis, tira a repetição e usa a última linha como o Vite', () => {
    const messy = [
      'OUTRA=1',
      'VITE_SUPABASE_URL=https://velha.supabase.co',
      `VITE_SUPABASE_URL=${url}`,
      `VITE_SUPABASE_ANON_KEY=${key}`,
      'VITE_SUPABASE_ANON_KEY=',
      'TERCEIRA=3',
    ].join('\n')

    const result = syncEnvFile(messy, url, key)

    expect(result.change).toBe('fixed')
    expect(result.content).toBe(`OUTRA=1\nTERCEIRA=3\n${wanted}`)
  })

  it('tira do .env.local o comentário do .env.example antigo, que faz o guard e o pre-commit barrarem', () => {
    const oldCopy = [
      '# Copie este arquivo para .env.local; ele não é versionado.',
      `VITE_SUPABASE_URL=${url}`,
      '# Chave pública (anon/publishable). NUNCA colocar a service_role aqui.',
      `VITE_SUPABASE_ANON_KEY=${key}`,
      '',
    ].join('\n')

    const result = syncEnvFile(oldCopy, url, key)

    expect(result.change).toBe('fixed')
    expect(result.content).toBe(
      `# Copie este arquivo para .env.local; ele não é versionado.\n${wanted}`,
    )
    expect(result.content).not.toMatch(/service_role/i)
  })

  it('funciona com um arquivo vazio ou sem a última quebra de linha', () => {
    expect(syncEnvFile('', url, key).content).toBe(wanted)
    expect(syncEnvFile('OUTRA=1', url, key).content).toBe(`OUTRA=1\n${wanted}`)
  })
})

describe('SEED_PLAN', () => {
  const { users, markets, closedDays, bookings } = SEED_PLAN
  const key = (booking: { market: string; dayOffset: number }) =>
    `${booking.market}|${booking.dayOffset}`
  const active = bookings.filter((booking) => booking.cancelledReason === undefined)

  it('tem um administrador com o e-mail combinado e fornecedores com e-mails únicos', () => {
    expect(users.filter((user) => user.role === 'admin').map((user) => user.email)).toEqual([
      'admin@admin.com',
    ])
    expect(new Set(users.map((user) => user.email)).size).toBe(users.length)
    expect(users.filter((user) => user.role === 'supplier').length).toBeGreaterThanOrEqual(5)
  })

  it('usa senhas que o Auth local aceita', () => {
    for (const user of users) {
      expect(user.password.length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH)
      expect(user.password.length).toBeLessThanOrEqual(MAX_PASSWORD_LENGTH)
    }
  })

  it('só cita mercados e fornecedores que existem', () => {
    const marketNames = new Set(markets.map((market) => market.name))
    const emails = new Set(users.map((user) => user.email))
    for (const item of [...closedDays, ...bookings]) expect(marketNames).toContain(item.market)
    for (const booking of bookings) expect(emails).toContain(booking.supplier)
  })

  it('só marca datas dentro da janela em que dá para reservar', () => {
    for (const item of [...closedDays, ...bookings]) {
      expect(item.dayOffset).toBeGreaterThanOrEqual(1)
      expect(item.dayOffset).toBeLessThanOrEqual(BOOKING_WINDOW_DAYS)
    }
  })

  it('nunca passa do limite do mercado nem repete o fornecedor no mesmo dia', () => {
    const capacity = new Map(markets.map((market) => [market.name, market.capacity]))
    const perDay = new Map<string, string[]>()
    for (const booking of active) {
      perDay.set(key(booking), [...(perDay.get(key(booking)) ?? []), booking.supplier])
    }
    for (const [slot, suppliers] of perDay) {
      const market = slot.split('|')[0] ?? ''
      expect(suppliers.length, slot).toBeLessThanOrEqual(capacity.get(market) ?? 0)
      expect(new Set(suppliers).size, slot).toBe(suppliers.length)
    }
  })

  it('não põe reserva ativa em fornecedor desativado nem em dia fechado', () => {
    const inactive = new Set(users.filter((user) => !user.active).map((user) => user.email))
    const closed = new Set(closedDays.map(key))
    for (const booking of active) {
      expect(inactive).not.toContain(booking.supplier)
      expect(closed, key(booking)).not.toContain(key(booking))
    }
  })

  it('mostra cada situação das telas: dia lotado, dia com vaga, data fechada, reserva cancelada, conta desativada', () => {
    const capacity = new Map(markets.map((market) => [market.name, market.capacity]))
    const counts = new Map<string, number>()
    for (const booking of active) counts.set(key(booking), (counts.get(key(booking)) ?? 0) + 1)
    const full = [...counts].some(
      ([slot, taken]) => taken === capacity.get(slot.split('|')[0] ?? ''),
    )
    const partial = [...counts].some(
      ([slot, taken]) => taken < (capacity.get(slot.split('|')[0] ?? '') ?? 0),
    )

    expect(full).toBe(true)
    expect(partial).toBe(true)
    expect(closedDays.length).toBeGreaterThan(0)
    expect(bookings.some((booking) => booking.cancelledReason !== undefined)).toBe(true)
    expect(users.some((user) => !user.active)).toBe(true)
  })
})
