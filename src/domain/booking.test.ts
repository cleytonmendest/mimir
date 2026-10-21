import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  BOOKING_REFUSALS,
  BOOKING_WINDOW_DAYS,
  bookableRange,
  CANCEL_REFUSALS,
  dayStatus,
  evaluateBooking,
  evaluateCancel,
  freeSlots,
  isBookableDay,
  type SlotState,
} from './booking'
import { addDays } from './dates'
import type { Actor } from './types'

const TODAY = '2026-10-21'
const ana: Actor = { id: 'u-ana', role: 'supplier' }
const bruno: Actor = { id: 'u-bruno', role: 'supplier' }
const lia: Actor = { id: 'u-lia', role: 'admin' }

describe('janela de reserva', () => {
  it('de amanhã até 60 dias à frente', () => {
    expect(BOOKING_WINDOW_DAYS).toBe(60)
    expect(bookableRange(TODAY)).toEqual({ from: '2026-10-22', to: '2026-12-20' })
    expect(bookableRange(TODAY, 7)).toEqual({ from: '2026-10-22', to: '2026-10-28' })
  })

  it('hoje e o passado não, o primeiro e o último dia sim, um além não', () => {
    expect(isBookableDay(TODAY, '2026-10-20')).toBe(false)
    expect(isBookableDay(TODAY, TODAY)).toBe(false)
    expect(isBookableDay(TODAY, '2026-10-22')).toBe(true)
    expect(isBookableDay(TODAY, '2026-12-20')).toBe(true)
    expect(isBookableDay(TODAY, '2026-12-21')).toBe(false)
  })

  it('a janela pode ser outra', () => {
    expect(isBookableDay(TODAY, '2026-10-29', 7)).toBe(false)
    expect(isBookableDay(TODAY, '2026-10-28', 7)).toBe(true)
  })
})

describe('evaluateBooking', () => {
  const slot: SlotState = {
    marketArchived: false,
    closed: false,
    capacity: 3,
    booked: 0,
    mine: false,
  }

  it('a janela usada na decisão pode ser outra', () => {
    const day = addDays(TODAY, 10)
    expect(evaluateBooking({ actor: ana, today: TODAY, day, slot })).toEqual({
      ok: true,
      alreadyBooked: false,
    })
    expect(evaluateBooking({ actor: ana, today: TODAY, day, slot, windowDays: 7 })).toEqual({
      ok: false,
      code: 'OUT_OF_WINDOW',
    })
  })

  it('todo código de recusa do vocabulário aparece em algum caso', () => {
    const day = addDays(TODAY, 3)
    const seen = new Set<string>()
    const attempts: [Actor, Partial<SlotState>][] = [
      [lia, {}],
      [ana, { marketArchived: true }],
      [ana, { closed: true }],
      [ana, { booked: 3 }],
    ]
    for (const [actor, change] of attempts) {
      const decision = evaluateBooking({ actor, today: TODAY, day, slot: { ...slot, ...change } })
      if (!decision.ok) seen.add(decision.code)
    }
    const late = evaluateBooking({ actor: ana, today: TODAY, day: TODAY, slot })
    if (!late.ok) seen.add(late.code)
    expect([...seen].sort()).toEqual([...BOOKING_REFUSALS].sort())
  })
})

describe('evaluateCancel', () => {
  const mine = { supplierId: ana.id, day: '2026-10-25', cancelled: false }

  it('o fornecedor cancela a própria reserva', () => {
    expect(evaluateCancel({ actor: ana, today: TODAY, booking: mine })).toEqual({
      ok: true,
      alreadyCancelled: false,
    })
  })

  it('a reserva de outro fornecedor é "não encontrada", para não revelar que existe', () => {
    expect(evaluateCancel({ actor: bruno, today: TODAY, booking: mine })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    })
  })

  it('o administrador cancela a reserva de qualquer um', () => {
    expect(evaluateCancel({ actor: lia, today: TODAY, booking: mine })).toEqual({
      ok: true,
      alreadyCancelled: false,
    })
  })

  it('cancelar de novo é sucesso', () => {
    expect(
      evaluateCancel({ actor: ana, today: TODAY, booking: { ...mine, cancelled: true } }),
    ).toEqual({ ok: true, alreadyCancelled: true })
  })

  it('a do próprio dia ainda se cancela; a de um dia que já passou é histórico', () => {
    expect(evaluateCancel({ actor: ana, today: TODAY, booking: { ...mine, day: TODAY } }).ok).toBe(
      true,
    )
    expect(
      evaluateCancel({ actor: ana, today: TODAY, booking: { ...mine, day: '2026-10-20' } }),
    ).toEqual({ ok: false, code: 'PAST' })
  })

  it('cancelar duas vezes uma reserva de dia passado não vira erro: já estava cancelada', () => {
    expect(
      evaluateCancel({
        actor: ana,
        today: TODAY,
        booking: { ...mine, day: '2026-10-01', cancelled: true },
      }),
    ).toEqual({ ok: true, alreadyCancelled: true })
  })

  it('o vocabulário de recusa de cancelamento', () => {
    expect([...CANCEL_REFUSALS]).toEqual(['NOT_FOUND', 'PAST', 'FORBIDDEN'])
  })
})

describe('dayStatus e vagas livres', () => {
  const base = { today: TODAY, closed: false, booked: 0, capacity: 3 }

  it('cada estado do calendário', () => {
    expect(dayStatus({ ...base, day: TODAY })).toBe('past')
    expect(dayStatus({ ...base, day: '2026-10-01' })).toBe('past')
    expect(dayStatus({ ...base, day: '2026-12-21' })).toBe('far')
    expect(dayStatus({ ...base, day: '2026-10-22', closed: true, booked: 3 })).toBe('closed')
    expect(dayStatus({ ...base, day: '2026-10-22', booked: 3 })).toBe('full')
    expect(dayStatus({ ...base, day: '2026-10-22', booked: 4 })).toBe('full')
    expect(dayStatus({ ...base, day: '2026-10-22', booked: 1 })).toBe('partial')
    expect(dayStatus({ ...base, day: '2026-10-22' })).toBe('free')
  })

  it('a janela do calendário pode ser outra', () => {
    expect(dayStatus({ ...base, day: '2026-10-29', windowDays: 7 })).toBe('far')
  })

  it('vagas livres nunca ficam negativas (limite reduzido abaixo das reservas)', () => {
    expect(freeSlots(3, 1)).toBe(2)
    expect(freeSlots(3, 3)).toBe(0)
    expect(freeSlots(2, 3)).toBe(0)
  })
})

/**
 * Modelo: aplica sequências aleatórias de operações com as próprias regras do domínio e confere o
 * que nunca pode acontecer. É o teste de "o limite nunca é passado", no lado do TypeScript.
 */
describe('modelo: o limite nunca é ultrapassado por uma reserva nova', () => {
  type Op =
    | { kind: 'book'; supplier: number; day: number }
    | { kind: 'cancel'; supplier: number; day: number }
    | { kind: 'capacity'; value: number }
    | { kind: 'close'; day: number }
    | { kind: 'open'; day: number }

  const op: fc.Arbitrary<Op> = fc.oneof(
    {
      weight: 6,
      arbitrary: fc.record({
        kind: fc.constant('book' as const),
        supplier: fc.nat(5),
        day: fc.integer({ min: 1, max: 3 }),
      }),
    },
    {
      weight: 2,
      arbitrary: fc.record({
        kind: fc.constant('cancel' as const),
        supplier: fc.nat(5),
        day: fc.integer({ min: 1, max: 3 }),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('capacity' as const),
        value: fc.integer({ min: 1, max: 4 }),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('close' as const),
        day: fc.integer({ min: 1, max: 3 }),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('open' as const),
        day: fc.integer({ min: 1, max: 3 }),
      }),
    },
  )

  it('em qualquer sequência, reserva aceita só entra com vaga, e ninguém reserva duas vezes o mesmo dia', () => {
    fc.assert(
      fc.property(fc.array(op, { maxLength: 60 }), (ops) => {
        let capacity = 2
        const closed = new Set<number>()
        const active = new Map<number, Set<number>>() // dia -> fornecedores com reserva ativa

        for (const step of ops) {
          if (step.kind === 'capacity') capacity = step.value
          else if (step.kind === 'close') closed.add(step.day)
          else if (step.kind === 'open') closed.delete(step.day)
          else if (step.kind === 'cancel') active.get(step.day)?.delete(step.supplier)
          else {
            const holders = active.get(step.day) ?? new Set<number>()
            const before = holders.size
            const decision = evaluateBooking({
              actor: { id: `s${step.supplier}`, role: 'supplier' },
              today: TODAY,
              day: addDays(TODAY, step.day),
              slot: {
                marketArchived: false,
                closed: closed.has(step.day),
                capacity,
                booked: before,
                mine: holders.has(step.supplier),
              },
            })
            if (decision.ok && !decision.alreadyBooked) {
              // O que nunca pode acontecer: aceitar uma reserva nova sem vaga ou em dia fechado.
              expect(before).toBeLessThan(capacity)
              expect(closed.has(step.day)).toBe(false)
              holders.add(step.supplier)
              active.set(step.day, holders)
            }
            if (decision.ok && decision.alreadyBooked) expect(holders.size).toBe(before)
          }
        }
      }),
      { numRuns: 300 },
    )
  })
})
