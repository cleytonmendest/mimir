import { evaluateBooking, evaluateCancel, type DayAvailability } from '@/domain/booking'
import { addDays, daysBetween } from '@/domain/dates'
import type { Actor, IsoDate } from '@/domain/types'
import type { BookingGateway } from '@/lib/supabase/booking-gateway'
import { RequestFailure, type RequestFailureCode } from '@/lib/supabase/errors'
import type { AdminBooking, Market, MyBooking } from '@/lib/supabase/mappers'

/** Apoio só para testes. Não importar em código de produção. */

export interface FakeBooking {
  id: string
  marketId: string
  day: IsoDate
  supplierId: string
  cancelled?: boolean
  cancelReason?: string | null
}

export interface FakeBookingSetup {
  /** Quem está logado: o fornecedor que reserva ou o administrador. */
  actor: Actor
  /** O "hoje" do servidor. */
  today: IsoDate
  markets: Market[]
  bookings?: FakeBooking[]
  closed?: { marketId: string; day: IsoDate; reason?: string | null }[]
  /** Nome de cada fornecedor (o que o administrador vê). */
  names?: Record<string, string>
}

export const market = (id: string, name: string, capacity = 3, archived = false): Market => ({
  id,
  name,
  address: null,
  archived,
  capacity,
})

/**
 * O servidor em memória, com as mesmas regras do domínio (evaluateBooking e evaluateCancel). Serve
 * aos testes de controlador e de tela; quem prova que o SQL decide igual são os casos compartilhados.
 * `fail` simula falha de rede/servidor; `beforeBook` deixa o teste mexer no servidor entre o clique e
 * a resposta (por exemplo, outro fornecedor ocupar a última vaga).
 */
export function createFakeBookingGateway(setup: FakeBookingSetup) {
  const markets = setup.markets.map((entry) => ({ ...entry }))
  const bookings: FakeBooking[] = (setup.bookings ?? []).map((entry) => ({ ...entry }))
  const closed = (setup.closed ?? []).map((entry) => ({ reason: null, ...entry }))
  const names = setup.names ?? {}
  const state = {
    fail: null as RequestFailureCode | null,
    beforeBook: null as (() => void) | null,
    nextId: 1,
    calls: [] as string[],
  }

  const active = (marketId: string, day: IsoDate) =>
    bookings.filter(
      (entry) => entry.marketId === marketId && entry.day === day && entry.cancelled !== true,
    )
  const find = (marketId: string) => markets.find((entry) => entry.id === marketId)

  function guard(call: string): void {
    state.calls.push(call)
    if (state.fail !== null) throw new RequestFailure(state.fail, `falha simulada: ${state.fail}`)
  }

  const gateway: BookingGateway = {
    listMarkets() {
      guard('listMarkets')
      return Promise.resolve(markets.map((entry) => ({ ...entry })))
    },

    availability(marketId, from, to) {
      guard('availability')
      const entry = find(marketId)
      if (entry === undefined) return Promise.resolve({ ok: false, code: 'MARKET_NOT_FOUND' })
      const days: DayAvailability[] = Array.from(
        { length: daysBetween(from, to) + 1 },
        (_, index) => {
          const day = addDays(from, index)
          const here = active(marketId, day)
          return {
            day,
            booked: here.length,
            closed: closed.some((c) => c.marketId === marketId && c.day === day),
            mine: here.some((b) => b.supplierId === setup.actor.id),
          }
        },
      )
      return Promise.resolve({
        ok: true,
        archived: entry.archived,
        availability: { today: setup.today, capacity: entry.capacity, days },
      })
    },

    book(marketId, day) {
      guard('book')
      state.beforeBook?.()
      const entry = find(marketId)
      const here = active(marketId, day)
      const decision = evaluateBooking({
        actor: setup.actor,
        today: setup.today,
        day,
        slot: {
          marketArchived: entry === undefined || entry.archived,
          closed: closed.some((c) => c.marketId === marketId && c.day === day),
          capacity: entry?.capacity ?? 0,
          booked: here.length,
          mine: here.some((b) => b.supplierId === setup.actor.id),
        },
      })
      if (!decision.ok) return Promise.resolve({ ok: false, code: decision.code })
      const capacity = entry?.capacity ?? 0
      if (decision.alreadyBooked) {
        const existing = here.find((b) => b.supplierId === setup.actor.id)
        return Promise.resolve({
          ok: true,
          bookingId: existing?.id ?? '',
          alreadyBooked: true,
          booked: here.length,
          capacity,
        })
      }
      const created: FakeBooking = {
        id: `b-${state.nextId++}`,
        marketId,
        day,
        supplierId: setup.actor.id,
      }
      bookings.push(created)
      return Promise.resolve({
        ok: true,
        bookingId: created.id,
        alreadyBooked: false,
        booked: here.length + 1,
        capacity,
      })
    },

    cancel(bookingId, reason) {
      guard('cancel')
      const target = bookings.find((b) => b.id === bookingId)
      if (target === undefined) return Promise.resolve({ ok: false, code: 'NOT_FOUND' })
      const decision = evaluateCancel({
        actor: setup.actor,
        today: setup.today,
        booking: {
          supplierId: target.supplierId,
          day: target.day,
          cancelled: target.cancelled === true,
        },
      })
      if (!decision.ok) return Promise.resolve({ ok: false, code: decision.code })
      if (!decision.alreadyCancelled) {
        target.cancelled = true
        target.cancelReason = setup.actor.role === 'admin' ? (reason ?? null) : null
      }
      return Promise.resolve({ ok: true, alreadyCancelled: decision.alreadyCancelled })
    },

    myBookings(from) {
      guard('myBookings')
      const mine: MyBooking[] = bookings
        .filter((b) => b.supplierId === setup.actor.id && b.cancelled !== true && b.day >= from)
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((b) => ({
          id: b.id,
          marketId: b.marketId,
          marketName: find(b.marketId)?.name ?? '',
          day: b.day,
        }))
      return Promise.resolve(mine)
    },

    adminBookings({ from, to, marketId }) {
      guard('adminBookings')
      const rows: AdminBooking[] = bookings
        .filter(
          (b) =>
            b.cancelled !== true &&
            b.day >= from &&
            (to === undefined || b.day <= to) &&
            (marketId === undefined || b.marketId === marketId),
        )
        .sort((a, b) => a.day.localeCompare(b.day))
        .map((b) => ({
          id: b.id,
          marketId: b.marketId,
          marketName: find(b.marketId)?.name ?? '',
          day: b.day,
          supplierId: b.supplierId,
          supplierName: names[b.supplierId] ?? '',
        }))
      return Promise.resolve(rows)
    },

    createMarket(input) {
      guard('createMarket')
      const created = market(`m-${state.nextId++}`, input.name, input.capacity)
      created.address = input.address
      markets.push(created)
      return Promise.resolve({ ...created })
    },

    updateMarket(id, patch) {
      guard('updateMarket')
      const entry = find(id)
      if (entry === undefined) return Promise.reject(new Error('mercado não existe'))
      if (patch.name !== undefined) entry.name = patch.name
      if (patch.address !== undefined) entry.address = patch.address
      if (patch.capacity !== undefined) entry.capacity = patch.capacity
      if (patch.archived !== undefined) entry.archived = patch.archived
      return Promise.resolve({ ...entry })
    },

    closedDays(marketId, from, to) {
      guard('closedDays')
      return Promise.resolve(
        closed
          .filter((c) => c.marketId === marketId && c.day >= from && c.day <= to)
          .sort((a, b) => a.day.localeCompare(b.day))
          .map((c) => ({ day: c.day, reason: c.reason ?? null })),
      )
    },

    closeDay(marketId, day, reason) {
      guard('closeDay')
      if (!closed.some((c) => c.marketId === marketId && c.day === day)) {
        closed.push({ marketId, day, reason: reason ?? null })
      }
      return Promise.resolve()
    },

    openDay(marketId, day) {
      guard('openDay')
      const index = closed.findIndex((c) => c.marketId === marketId && c.day === day)
      if (index >= 0) closed.splice(index, 1)
      return Promise.resolve()
    },
  }

  return {
    gateway,
    /** O que está no "servidor" agora, para o teste conferir. */
    bookings,
    closed,
    markets,
    state,
    /** Outro fornecedor ocupa uma vaga (sem passar pelas regras): para montar o cenário. */
    occupy: (marketId: string, day: IsoDate, supplierId: string): void => {
      bookings.push({ id: `b-${state.nextId++}`, marketId, day, supplierId })
    },
  }
}
