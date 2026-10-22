import { describe, expect, it } from 'vitest'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../src/domain/access.ts'
import { refuseNonLocal, SEED_PLAN } from './seed-dev.ts'

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
