import { describe, expect, it } from 'vitest'
import { carryOver, closeDay, NO_CHECKOUT_REASON } from './carryover'
import { checkIn } from './execution'
import {
  addVisit,
  cancelVisit,
  moveVisitToDate,
  reopenVisit,
  reorderVisit,
  type PlanContext,
} from './plan'
import { transition } from './status'
import { generateWeek } from './week'
import type { StandardRouteEntry, Visit } from './types'
import { ana, deepFreeze, idGenerator, leader, makeVisit } from './testing'

/**
 * Regras combinadas entre amigo e liderança, escritas como teste.
 * Se uma delas quebrar, o CI fica vermelho: é a memória do projeto.
 * Regra decidida mas ainda sem código entra aqui como it.todo, nunca só numa conversa.
 */

const TODAY = '2026-10-20' // terça
const NOW = '2026-10-20T12:00:00.000Z'

const route: StandardRouteEntry[] = deepFreeze([
  { repositorId: ana.id, weekday: 2, marketId: 'market-a', order: 0 },
  { repositorId: ana.id, weekday: 2, marketId: 'market-b', order: 1 },
  { repositorId: ana.id, weekday: 3, marketId: 'market-c', order: 0 },
  { repositorId: ana.id, weekday: 4, marketId: 'market-d', order: 0 },
])

function ctx(): PlanContext {
  return { actor: leader, now: NOW, today: TODAY, newId: idGenerator('ex') }
}

function openWeek(existing: readonly Visit[] = []) {
  return generateWeek({
    route,
    existing,
    repositorId: ana.id,
    weekOf: TODAY,
    today: TODAY,
    newId: idGenerator('std'),
  })
}

describe('regras confirmadas', () => {
  it('gerar a semana é idempotente', () => {
    const week = openWeek()
    expect(week).toHaveLength(4)
    expect(openWeek(week)).toEqual([])
  })

  it('exceção em um dia não altera a rota padrão e não é desfeita ao reabrir a semana', () => {
    const week = deepFreeze(openWeek())
    const wednesday = week.find((visit) => visit.marketId === 'market-c')!
    const tuesdayB = week.find((visit) => visit.marketId === 'market-b')!

    const afterCancel = cancelVisit(week, wednesday.id, ctx()).visits
    const afterMove = moveVisitToDate(
      afterCancel,
      tuesdayB.id,
      { date: '2026-10-24', order: 0 },
      ctx(),
    ).visits

    // A rota padrão continua exatamente igual (está congelada: mutar quebraria).
    expect(route).toHaveLength(4)

    // Reabrir a semana não traz de volta o cancelado nem o remanejado.
    expect(openWeek(afterMove)).toEqual([])
  })

  it('o que não foi feito passa para o dia seguinte uma única vez', () => {
    const week = openWeek()
    const wednesday = '2026-10-21'
    const tuesday = week.filter((visit) => visit.date === TODAY)

    // Terça: um não foi, o outro ninguém registrou. Na quarta o dia é fechado.
    const skipped = transition(
      tuesday[0]!,
      { type: 'markNotDone', reason: 'Fechado' },
      { actor: ana, now: NOW, today: TODAY },
    )
    const afterDay = [skipped, ...week.filter((visit) => visit.id !== skipped.id)]
    const closed = closeDay(afterDay, TODAY, wednesday)
    const settled = afterDay.map((visit) => closed.find((c) => c.id === visit.id) ?? visit)

    const carried = carryOver({
      visits: settled,
      fromDate: TODAY,
      toDate: wednesday,
      newId: idGenerator('carry'),
    })
    expect(carried.map((visit) => visit.marketId).sort()).toEqual(['market-a', 'market-b'])

    // Na quarta ninguém foi de novo: não vira sobra da sobra, e rodar de novo não duplica.
    const next = [...settled, ...carried].map((visit) =>
      visit.origin === 'carryover' ? { ...visit, status: 'not_done' as const } : visit,
    )
    expect(
      carryOver({
        visits: next,
        fromDate: wednesday,
        toDate: '2026-10-22',
        newId: idGenerator('c2'),
      }),
    ).toEqual([])
    expect(
      carryOver({ visits: next, fromDate: TODAY, toDate: wednesday, newId: idGenerator('c3') }),
    ).toEqual([])
  })

  it('check-out não existe sem check-in, e concluída não volta a planejada sem o líder', () => {
    const visit = makeVisit({ date: TODAY })
    expect(() =>
      transition(visit, { type: 'checkOut' }, { actor: ana, now: NOW, today: TODAY }),
    ).toThrow()

    const done = makeVisit({ date: TODAY, status: 'done' })
    expect(() => reopenVisit([done], done.id, { ...ctx(), actor: ana })).toThrow()
    expect(reopenVisit([done], done.id, ctx()).visits[0]?.status).toBe('planned')
  })

  it('toda mudança feita pelo líder gera log de quem mudou o quê', () => {
    const base = deepFreeze([
      makeVisit({ id: 'v1', date: '2026-10-22' }),
      makeVisit({ id: 'v2', marketId: 'm2', date: '2026-10-22', status: 'done' }),
    ])
    const results = [
      addVisit(base, { repositorId: ana.id, marketId: 'm9', date: '2026-10-23', order: 0 }, ctx()),
      reorderVisit(base, 'v1', 3, ctx()),
      cancelVisit(base, 'v1', ctx()),
      moveVisitToDate(base, 'v1', { date: '2026-10-23', order: 0 }, ctx()),
      reopenVisit(base, 'v2', ctx()),
    ]

    for (const result of results) {
      expect(result.audit.length).toBeGreaterThan(0)
      for (const entry of result.audit) {
        expect(entry).toMatchObject({ actorId: leader.id, actorRole: 'leader', at: NOW })
        expect(Object.keys(entry.changes).length).toBeGreaterThan(0)
      }
    }
  })

  it('repositor com dois check-ins abertos: o novo check-in encerra o anterior sozinho', () => {
    const a = makeVisit({ id: 'a', marketId: 'market-a', date: TODAY })
    const b = makeVisit({ id: 'b', marketId: 'market-b', date: TODAY, order: 1 })
    const afterA = checkIn([a, b], 'a', {
      actor: ana,
      now: '2026-10-20T10:00:00.000Z',
      today: TODAY,
    })
    const state = [...afterA, b]
    const changed = checkIn(state, 'b', { actor: ana, now: NOW, today: TODAY })

    expect(changed.map((visit) => [visit.id, visit.status])).toEqual([
      ['b', 'in_progress'],
      ['a', 'done'],
    ])
    expect(changed.find((visit) => visit.id === 'a')?.checkOutAt).toBe(NOW)
  })

  it('reabrir visita que já foi adiada para o dia seguinte oferece cancelar a adiada', () => {
    const missed = makeVisit({ id: 'm1', date: TODAY, status: 'not_done', skipReason: 'Fechado' })
    const [copy] = carryOver({
      visits: [missed],
      fromDate: TODAY,
      toDate: '2026-10-21',
      newId: idGenerator('c'),
    })
    const result = reopenVisit([missed, copy!], 'm1', ctx())

    expect(result.postponedCopy?.id).toBe(copy!.id)
    const afterCancel = cancelVisit(result.visits, copy!.id, ctx()).visits
    expect(afterCancel.find((visit) => visit.id === copy!.id)?.status).toBe('cancelled')
  })

  it('visita esquecida "em andamento" de dia anterior vira "não foi" ao fechar o dia', () => {
    const forgotten = makeVisit({
      id: 'f1',
      date: TODAY,
      status: 'in_progress',
      checkInAt: '2026-10-20T09:00:00.000Z',
    })
    const [closed] = closeDay([forgotten], TODAY, '2026-10-21')
    expect(closed).toMatchObject({ status: 'not_done', skipReason: NO_CHECKOUT_REASON })
  })
})
