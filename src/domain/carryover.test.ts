import { describe, expect, it } from 'vitest'
import { carryOver, closeDay, NO_CHECKOUT_REASON, NO_RECORD_REASON } from './carryover'
import { DomainError } from './errors'
import { ana, bruno, deepFreeze, idGenerator, makeVisit } from './testing'

const D1 = '2026-10-20'
const D2 = '2026-10-21'

describe('fechar o dia', () => {
  const visits = deepFreeze([
    makeVisit({ id: 'p', date: D1, status: 'planned' }),
    makeVisit({ id: 'd', date: D1, marketId: 'm2', status: 'done' }),
    makeVisit({ id: 'i', date: D1, marketId: 'm3', status: 'in_progress' }),
    makeVisit({ id: 'other-day', date: D2, marketId: 'm4', status: 'planned' }),
  ])

  it('planejada de dia que passou vira "não foi" com motivo padrão', () => {
    const changed = closeDay(visits, D1, D2)
    expect(changed.find((visit) => visit.id === 'p')).toMatchObject({
      status: 'not_done',
      skipReason: NO_RECORD_REASON,
    })
  })

  it('"em andamento" esquecida (sem check-out) de dia que passou também vira "não foi"', () => {
    const changed = closeDay(visits, D1, D2)
    expect(changed.map((visit) => visit.id).sort()).toEqual(['i', 'p'])
    expect(changed.find((visit) => visit.id === 'i')).toMatchObject({
      status: 'not_done',
      skipReason: NO_CHECKOUT_REASON,
    })
  })

  it('o que já foi feito não é mexido', () => {
    expect(closeDay(visits, D1, D2).some((visit) => visit.id === 'd')).toBe(false)
  })

  it('não fecha o dia de hoje nem dias futuros', () => {
    expect(closeDay(visits, D1, D1)).toEqual([])
    expect(closeDay(visits, D2, D1)).toEqual([])
  })
})

describe('passar para o dia seguinte o que não foi feito', () => {
  const missed = (overrides = {}) =>
    makeVisit({ id: 'm1', date: D1, status: 'not_done', skipReason: 'Fechado', ...overrides })

  function run(visits = [missed()], toDate = D2) {
    return carryOver({ visits, fromDate: D1, toDate, newId: idGenerator('carry') })
  }

  it('cria visita planejada, com origem "carryover" e referência ao dia de origem', () => {
    expect(run()).toEqual([
      expect.objectContaining({
        id: 'carry-1',
        date: D2,
        status: 'planned',
        origin: 'carryover',
        carriedFromDate: D1,
        marketId: 'market-a',
        skipReason: null,
      }),
    ])
  })

  it('só passa o que está "não foi" e é do dia de origem', () => {
    const visits = [
      missed(),
      missed({ id: 'p', marketId: 'x1', status: 'planned', skipReason: null }),
      missed({ id: 'd', marketId: 'x2', status: 'done' }),
      missed({ id: 'c', marketId: 'x3', status: 'cancelled' }),
      missed({ id: 'other', marketId: 'x4', date: '2026-10-19' }),
    ]
    expect(run(visits).map((visit) => visit.marketId)).toEqual(['market-a'])
  })

  it('não acumula em cascata: sobra que também não foi feita não passa de novo', () => {
    const visits = [missed({ origin: 'carryover', carriedFromDate: '2026-10-19' })]
    expect(run(visits)).toEqual([])
  })

  it('é idempotente: rodar duas vezes não duplica', () => {
    const visits = [missed()]
    const first = run(visits)
    expect(run([...visits, ...first])).toEqual([])
  })

  it('não duplica se o mercado já está na agenda do dia seguinte', () => {
    const already = makeVisit({ id: 'already', date: D2, status: 'planned' })
    expect(run([missed(), already])).toEqual([])
  })

  it('entra no fim da agenda do destino, por repositor, mantendo a ordem relativa', () => {
    const visits = deepFreeze([
      missed({ id: 'a', marketId: 'late', order: 4 }),
      missed({ id: 'b', marketId: 'early', order: 1 }),
      missed({ id: 'c', marketId: 'bruno-m', repositorId: bruno.id, order: 0 }),
      makeVisit({ id: 'x0', marketId: 'x0', date: D2, order: 0 }),
      makeVisit({ id: 'x2', marketId: 'x2', date: D2, order: 2 }),
    ])
    const created = run([...visits])

    const byMarket = Object.fromEntries(created.map((visit) => [visit.marketId, visit.order]))
    expect(byMarket).toEqual({ early: 3, late: 4, 'bruno-m': 0 })
    expect(created.find((visit) => visit.marketId === 'early')?.repositorId).toBe(ana.id)
  })

  it.each([D1, '2026-10-19'])('o destino precisa ser depois da origem (recebeu %s)', (toDate) => {
    expect(() => run([missed()], toDate)).toThrow(DomainError)
    expect(() => run([missed()], toDate)).toThrow(/depois da origem/)
  })
})
