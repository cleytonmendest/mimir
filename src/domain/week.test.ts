import { describe, expect, it } from 'vitest'
import { generateWeek } from './week'
import type { StandardRouteEntry } from './types'
import { ana, bruno, deepFreeze, idGenerator, makeVisit } from './testing'

// 2026-10-20 é terça-feira.
const TODAY = '2026-10-20'

const route: StandardRouteEntry[] = deepFreeze([
  { repositorId: ana.id, weekday: 2, marketId: 'market-b', order: 1 },
  { repositorId: ana.id, weekday: 2, marketId: 'market-a', order: 0 },
  { repositorId: ana.id, weekday: 3, marketId: 'market-c', order: 0 },
  { repositorId: bruno.id, weekday: 2, marketId: 'market-z', order: 0 },
])

function run(overrides: Partial<Parameters<typeof generateWeek>[0]> = {}) {
  return generateWeek({
    route,
    existing: [],
    repositorId: ana.id,
    weekOf: '2026-10-21',
    today: TODAY,
    newId: idGenerator('new'),
    ...overrides,
  })
}

describe('gerar a semana a partir da rota padrão', () => {
  it('cria as visitas do repositor, em ordem de dia e de rota, com origem "standard"', () => {
    const created = run()

    expect(created.map((visit) => [visit.date, visit.marketId, visit.order])).toEqual([
      ['2026-10-20', 'market-a', 0],
      ['2026-10-20', 'market-b', 1],
      ['2026-10-21', 'market-c', 0],
    ])
    expect(
      created.every((visit) => visit.status === 'planned' && visit.origin === 'standard'),
    ).toBe(true)
    expect(created.every((visit) => visit.repositorId === ana.id)).toBe(true)
  })

  it('é idempotente: abrir a semana duas vezes não duplica visitas', () => {
    const first = run()
    const second = run({ existing: first })
    expect(second).toEqual([])
  })

  it('não gera dias que já passaram', () => {
    const created = run({ today: '2026-10-21' })
    expect(created.map((visit) => visit.marketId)).toEqual(['market-c'])
  })

  it('qualquer dia da semana serve de referência, inclusive o domingo', () => {
    const created = run({ weekOf: '2026-10-25', today: '2026-10-19' })
    expect(created).toHaveLength(3)
  })

  it('não ressuscita visita cancelada (remanejada ou removida de propósito)', () => {
    const cancelled = makeVisit({
      id: 'old',
      marketId: 'market-a',
      date: '2026-10-20',
      status: 'cancelled',
    })
    const created = run({ existing: [cancelled] })
    expect(created.map((visit) => visit.marketId)).toEqual(['market-b', 'market-c'])
  })

  it('não duplica quando o mercado já foi adicionado manualmente no dia', () => {
    const manual = makeManualVisit()
    const created = run({ existing: [manual] })
    expect(created.map((visit) => visit.marketId)).toEqual(['market-b', 'market-c'])
  })

  it('não mistura repositores', () => {
    const created = run({ repositorId: bruno.id })
    expect(created.map((visit) => [visit.repositorId, visit.marketId])).toEqual([
      [bruno.id, 'market-z'],
    ])
  })

  it('rota com o mesmo mercado repetido no mesmo dia gera uma visita só', () => {
    const dirty = [
      ...route,
      { repositorId: ana.id, weekday: 3 as const, marketId: 'market-c', order: 5 },
    ]
    const created = run({ route: dirty })
    expect(created.filter((visit) => visit.marketId === 'market-c')).toHaveLength(1)
  })

  it('rota vazia não gera nada', () => {
    expect(run({ route: [] })).toEqual([])
  })

  it('não altera a rota nem a lista existente recebidas', () => {
    const existing = deepFreeze([makeVisit({ marketId: 'market-a', date: '2026-10-20' })])
    expect(() => run({ existing })).not.toThrow()
  })
})

function makeManualVisit() {
  return makeVisit({
    id: 'manual',
    marketId: 'market-a',
    date: '2026-10-20',
    origin: 'exception',
  })
}
