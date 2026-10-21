import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { NO_CHECKOUT_REASON } from './carryover'
import { addDays, companyDate } from './dates'
import { DomainError } from './errors'
import { AUTO_CHECKOUT_NOTE, checkIn, checkInEvents } from './execution'
import { projectVisits } from './projection'
import type { OfflineEvent } from './sync'
import { ana, bruno, deepFreeze, makeVisit } from './testing'
import type { Visit } from './types'

const TODAY = '2026-10-20'
const NOW = '2026-10-20T12:00:00.000Z'
const ctx = { actor: ana, now: NOW, today: TODAY }

describe('check-in com um mercado aberto por vez', () => {
  it('sem outra visita aberta, só a nova muda', () => {
    const visits = deepFreeze([makeVisit({ id: 'a', date: TODAY })])
    const changed = checkIn(visits, 'a', ctx)
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({ status: 'in_progress', checkInAt: NOW })
  })

  it('encerra a anterior do mesmo dia como feita, com check-out na hora do novo check-in', () => {
    const visits = deepFreeze([
      makeVisit({
        id: 'old',
        marketId: 'm1',
        date: TODAY,
        status: 'in_progress',
        checkInAt: '2026-10-20T09:00:00.000Z',
      }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ])
    const changed = checkIn(visits, 'new', ctx)
    expect(changed.map((visit) => visit.id)).toEqual(['new', 'old'])
    expect(changed[1]).toMatchObject({ status: 'done', checkOutAt: NOW, note: AUTO_CHECKOUT_NOTE })
  })

  it('mantém a observação que o repositor já tinha escrito', () => {
    const visits = [
      makeVisit({
        id: 'old',
        marketId: 'm1',
        date: TODAY,
        status: 'in_progress',
        checkInAt: '2026-10-20T09:00:00.000Z',
        note: 'Faltou leite',
      }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ]
    expect(checkIn(visits, 'new', ctx)[1]?.note).toBe('Faltou leite')
  })

  it('a anterior de um dia que já passou vira "não foi", não "feita"', () => {
    const visits = [
      makeVisit({
        id: 'old',
        marketId: 'm1',
        date: '2026-10-19',
        status: 'in_progress',
        checkInAt: '2026-10-19T09:00:00.000Z',
      }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ]
    expect(checkIn(visits, 'new', ctx)[1]).toMatchObject({
      status: 'not_done',
      skipReason: NO_CHECKOUT_REASON,
    })
  })

  it('o check-out automático nunca fica antes do check-in (relógio offline atrasado)', () => {
    const checkInAt = '2026-10-20T15:00:00.000Z'
    const visits = [
      makeVisit({ id: 'old', marketId: 'm1', date: TODAY, status: 'in_progress', checkInAt }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ]
    expect(checkIn(visits, 'new', ctx)[1]?.checkOutAt).toBe(checkInAt)
  })

  it('in_progress sem hora de check-in (dado corrompido) ainda fecha de forma consistente', () => {
    const visits = [
      makeVisit({ id: 'old', marketId: 'm1', date: TODAY, status: 'in_progress', checkInAt: null }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ]
    expect(checkIn(visits, 'new', ctx)[1]).toMatchObject({ checkInAt: NOW, checkOutAt: NOW })
  })

  it('não mexe nas visitas abertas de outro repositor', () => {
    const visits = [
      makeVisit({
        id: 'other',
        repositorId: bruno.id,
        marketId: 'm1',
        date: TODAY,
        status: 'in_progress',
        checkInAt: NOW,
      }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ]
    expect(checkIn(visits, 'new', ctx).map((visit) => visit.id)).toEqual(['new'])
  })

  it('check-in inválido não encerra nada: ou muda tudo ou não muda nada', () => {
    const visits = [
      makeVisit({ id: 'old', marketId: 'm1', date: TODAY, status: 'in_progress', checkInAt: NOW }),
      makeVisit({ id: 'future', marketId: 'm2', date: '2026-10-21' }),
    ]
    expect(() => checkIn(visits, 'future', ctx)).toThrow(DomainError)
  })

  it('visita que não existe', () => {
    expect(() => checkIn([], 'nada', ctx)).toThrow(/não existe/)
  })
})

describe('check-in como eventos para a fila offline', () => {
  const open = (overrides: Partial<Visit>) =>
    makeVisit({
      id: 'old',
      marketId: 'm1',
      date: TODAY,
      status: 'in_progress',
      checkInAt: '2026-10-20T09:00:00.000Z',
      ...overrides,
    })
  const fresh = makeVisit({ id: 'new', marketId: 'm2', date: TODAY })

  it('sem outra visita aberta, é só o check-in', () => {
    const { event, derived } = checkInEvents(deepFreeze([fresh]), 'new', ctx)
    expect(event).toEqual({ type: 'checkIn', visitId: 'new', occurredAt: NOW })
    expect(derived).toEqual([])
  })

  it('a visita aberta do mesmo dia vira um check-out explícito, na hora do novo check-in', () => {
    const { event, derived } = checkInEvents(deepFreeze([open({}), fresh]), 'new', ctx)
    expect(event.visitId).toBe('new')
    expect(derived).toEqual([
      { type: 'checkOut', visitId: 'old', occurredAt: NOW, note: AUTO_CHECKOUT_NOTE },
    ])
  })

  it('mantém a observação que o repositor já tinha escrito', () => {
    const { derived } = checkInEvents([open({ note: 'Faltou leite' }), fresh], 'new', ctx)
    expect(derived[0]).toMatchObject({ type: 'checkOut', note: 'Faltou leite' })
  })

  it('a visita aberta de um dia que já passou vira um "não fui: Sem check-out"', () => {
    const { derived } = checkInEvents([open({ date: '2026-10-19' }), fresh], 'new', ctx)
    expect(derived).toEqual([
      { type: 'markNotDone', visitId: 'old', occurredAt: NOW, reason: NO_CHECKOUT_REASON },
    ])
  })

  it('o check-out nunca fica antes do check-in (relógio do aparelho atrasado)', () => {
    const checkInAt = '2026-10-20T15:00:00.000Z'
    const { derived } = checkInEvents([open({ checkInAt }), fresh], 'new', ctx)
    expect(derived[0]?.occurredAt).toBe(checkInAt)
  })

  it('sem hora de check-in (dado corrompido), o evento sai na hora do novo check-in', () => {
    const { derived } = checkInEvents([open({ checkInAt: null }), fresh], 'new', ctx)
    expect(derived[0]?.occurredAt).toBe(NOW)
  })

  it('não encerra as visitas abertas de outro repositor', () => {
    const other = open({ repositorId: bruno.id })
    expect(checkInEvents([other, fresh], 'new', ctx).derived).toEqual([])
  })

  it('check-in inválido não gera nada: ou grava tudo ou não grava nada', () => {
    const future = makeVisit({ id: 'future', marketId: 'm3', date: '2026-10-21' })
    expect(() => checkInEvents([open({}), future], 'future', ctx)).toThrow(DomainError)
    const past = makeVisit({ id: 'past', marketId: 'm3', date: '2026-10-19' })
    expect(() => checkInEvents([open({}), past], 'past', ctx)).toThrow(/dia que já passou/)
  })

  it('visita que não existe', () => {
    expect(() => checkInEvents([], 'nada', ctx)).toThrow(/não existe/)
  })

  describe('equivale ao check-in com visitas alteradas (propriedade)', () => {
    const openVisit = fc.record({
      daysAgo: fc.integer({ min: 0, max: 3 }),
      // Em relação a "agora": positivo é um check-in no futuro, ou seja, relógio que estava adiantado.
      minutesFromNow: fc.integer({ min: -720, max: 120 }),
      note: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: null }),
      repositorId: fc.constantFrom(ana.id, bruno.id),
    })
    const scenario = fc.record({
      nowMs: fc.integer({
        min: Date.parse('2026-01-01T00:00:00Z'),
        max: Date.parse('2027-12-31T00:00:00Z'),
      }),
      openVisits: fc.array(openVisit, { maxLength: 4 }),
    })

    it('aplicados pelas regras do servidor, os eventos dão as mesmas visitas', () => {
      fc.assert(
        fc.property(scenario, ({ nowMs, openVisits }) => {
          const now = new Date(nowMs).toISOString()
          const today = companyDate(now)
          const context = { actor: ana, now, today }
          const visits = deepFreeze([
            makeVisit({ id: 'target', marketId: 'm-target', date: today }),
            ...openVisits.map((item, index) =>
              makeVisit({
                id: `open-${index}`,
                marketId: `m-${index}`,
                repositorId: item.repositorId,
                date: addDays(today, -item.daysAgo),
                status: 'in_progress',
                checkInAt: new Date(nowMs + item.minutesFromNow * 60_000).toISOString(),
                note: item.note,
              }),
            ),
          ])

          const changed = checkIn(visits, 'target', context)
          const expected = visits.map((visit) => changed.find((c) => c.id === visit.id) ?? visit)

          const { event, derived } = checkInEvents(visits, 'target', context)
          const pending = [event, ...derived].map((draft, index): OfflineEvent => ({
            ...draft,
            clientEventId: `e${index}`,
            seq: index + 1,
          }))
          const projected = projectVisits({ visits, pending, actor: ana })

          expect(projected.rejected).toEqual([])
          expect(projected.visits).toEqual(expected)
        }),
      )
    })
  })
})
