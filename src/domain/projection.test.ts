import { describe, expect, it } from 'vitest'
import { projectVisits } from './projection'
import type { OfflineEvent } from './sync'
import { ana, bruno, deepFreeze, makeVisit } from './testing'

const TODAY = '2026-10-21'
const T0 = '2026-10-21T12:00:00.000Z'
const T1 = '2026-10-21T12:40:00.000Z'

const a = makeVisit({ id: 'a', marketId: 'm1', date: TODAY, order: 0 })
const b = makeVisit({ id: 'b', marketId: 'm2', date: TODAY, order: 1 })

function event(overrides: Partial<OfflineEvent> & Pick<OfflineEvent, 'clientEventId' | 'seq'>) {
  return { visitId: 'a', occurredAt: T0, type: 'checkIn', ...overrides } as OfflineEvent
}

describe('o que o repositor vê: servidor mais pendentes', () => {
  it('sem pendentes, é exatamente o que o servidor disse', () => {
    const visits = deepFreeze([a, b])
    const { visits: shown, rejected } = projectVisits({ visits, pending: [], actor: ana })

    expect(shown).toEqual([a, b])
    expect(rejected).toEqual([])
  })

  it('aplica o que o repositor já fez e ainda não enviou, sem mexer na entrada', () => {
    const visits = deepFreeze([a, b])
    const pending = deepFreeze([
      event({ clientEventId: 'e1', seq: 1 }),
      event({ clientEventId: 'e2', seq: 2, occurredAt: T1, type: 'checkOut', note: 'Ok' }),
      event({ clientEventId: 'e3', seq: 3, visitId: 'b', type: 'markNotDone', reason: 'Fechado' }),
    ])

    const { visits: shown, rejected } = projectVisits({ visits, pending, actor: ana })

    expect(shown.map((visit) => [visit.id, visit.status])).toEqual([
      ['a', 'done'],
      ['b', 'not_done'],
    ])
    expect(shown[0]).toMatchObject({ checkInAt: T0, checkOutAt: T1, note: 'Ok' })
    expect(rejected).toEqual([])
  })

  it('mantém a ordem das visitas da entrada', () => {
    const { visits: shown } = projectVisits({
      visits: [b, a],
      pending: [event({ clientEventId: 'e1', seq: 1 })],
      actor: ana,
    })
    expect(shown.map((visit) => visit.id)).toEqual(['b', 'a'])
  })

  it('o que a cópia não aceita fica de fora da tela e é listado', () => {
    // O servidor já cancelou a visita b: o "não fui" pendente não se aplica mais.
    const cancelled = makeVisit({ id: 'b', date: TODAY, status: 'cancelled' })
    const { visits: shown, rejected } = projectVisits({
      visits: [a, cancelled],
      pending: [
        event({ clientEventId: 'e1', seq: 1, visitId: 'b', type: 'markNotDone', reason: 'x' }),
      ],
      actor: ana,
    })

    expect(shown[1]?.status).toBe('cancelled')
    expect(rejected).toEqual([{ clientEventId: 'e1', code: 'INVALID_TRANSITION' }])
  })

  it('evento de uma visita que a cópia não tem é listado, sem quebrar o resto', () => {
    const { visits: shown, rejected } = projectVisits({
      visits: [a],
      pending: [
        event({ clientEventId: 'e1', seq: 1, visitId: 'sumiu' }),
        event({ clientEventId: 'e2', seq: 2 }),
      ],
      actor: ana,
    })

    expect(shown[0]?.status).toBe('in_progress')
    expect(rejected).toEqual([{ clientEventId: 'e1', code: 'VISIT_NOT_FOUND' }])
  })

  it('outro usuário no mesmo aparelho não enxerga o trabalho do primeiro (FORBIDDEN)', () => {
    const { visits: shown, rejected } = projectVisits({
      visits: [a],
      pending: [event({ clientEventId: 'e1', seq: 1 })],
      actor: bruno,
    })

    expect(shown).toEqual([a])
    expect(rejected).toEqual([{ clientEventId: 'e1', code: 'FORBIDDEN' }])
  })

  it('evento já refletido na cópia do servidor (resposta perdida) não muda nada', () => {
    const started = makeVisit({ id: 'a', date: TODAY, status: 'in_progress', checkInAt: T0 })
    const { visits: shown, rejected } = projectVisits({
      visits: [started],
      pending: [event({ clientEventId: 'e1', seq: 1 })],
      actor: ana,
    })

    expect(shown).toEqual([started])
    expect(rejected).toEqual([{ clientEventId: 'e1', code: 'INVALID_TRANSITION' }])
  })
})
