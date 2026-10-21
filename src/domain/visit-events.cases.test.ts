import { describe, expect, it } from 'vitest'
import type { DomainErrorCode } from './errors'
import { projectVisits } from './projection'
import { applyOfflineEvents, type OfflineEvent } from './sync'
import { ana, bruno, makeVisit } from './testing'
import { VISIT_STATUSES, type Visit } from './types'
import fixture from './fixtures/visit-events.cases.json'

/**
 * Os casos de `fixtures/visit-events.cases.json` valem para o domínio (aqui) e para a função do
 * servidor `sync_visit_events_v1` (pgTAP, gerado a partir do mesmo arquivo).
 */

type Outcome = Pick<Visit, 'status' | 'checkInAt' | 'checkOutAt' | 'note' | 'skipReason'>

interface CaseEvent {
  type: OfflineEvent['type']
  occurredAt: string
  seq?: number
  note?: string
  reason?: string
}

interface Case {
  name: string
  actor: 'owner' | 'other'
  visit: Outcome & Pick<Visit, 'date'>
  events: CaseEvent[]
  expect: {
    applied: number[]
    rejected: { event: number; code: DomainErrorCode }[]
    visit: Outcome
  }
}

const { cases } = fixture as { cases: Case[] }

function visitOf(item: Case): Visit {
  return makeVisit({ id: 'v1', repositorId: ana.id, ...item.visit })
}

function eventsOf(item: Case): OfflineEvent[] {
  return item.events.map((event, index): OfflineEvent => {
    const base = {
      clientEventId: `e${index}`,
      seq: event.seq ?? index + 1,
      visitId: 'v1',
      occurredAt: event.occurredAt,
    }
    switch (event.type) {
      case 'checkIn':
        return { ...base, type: 'checkIn' }
      case 'checkOut':
        return {
          ...base,
          type: 'checkOut',
          ...(event.note === undefined ? {} : { note: event.note }),
        }
      case 'markNotDone':
        return { ...base, type: 'markNotDone', reason: event.reason ?? '' }
    }
  })
}

function outcomeOf(visit: Visit): Outcome {
  const { status, checkInAt, checkOutAt, note, skipReason } = visit
  return { status, checkInAt, checkOutAt, note, skipReason }
}

describe('casos compartilhados com o servidor', () => {
  it('os nomes são únicos (viram o nome de cada teste do banco)', () => {
    const names = cases.map((item) => item.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('cobrem todo estado de visita × todo tipo de evento', () => {
    const covered = new Set(cases.map((item) => `${item.visit.status}/${item.events[0]?.type}`))
    const wanted = VISIT_STATUSES.flatMap((status) =>
      (['checkIn', 'checkOut', 'markNotDone'] as const).map((type) => `${status}/${type}`),
    )
    expect(wanted.filter((combination) => !covered.has(combination))).toEqual([])
  })

  describe.each(cases)('$name', (item) => {
    const actor = item.actor === 'owner' ? ana : bruno

    it('applyOfflineEvents dá o resultado esperado', () => {
      const result = applyOfflineEvents({
        visit: visitOf(item),
        events: eventsOf(item),
        alreadyApplied: new Set(),
        actor,
      })

      expect(result.applied.map((id) => Number(id.slice(1))).sort((a, b) => a - b)).toEqual(
        item.expect.applied,
      )
      expect(
        result.rejected.map(({ clientEventId, code }) => ({
          event: Number(clientEventId.slice(1)),
          code,
        })),
      ).toEqual(item.expect.rejected)
      expect(outcomeOf(result.visit)).toEqual(item.expect.visit)
    })

    it('projectVisits mostra o mesmo, e lista os mesmos recusados', () => {
      const projected = projectVisits({ visits: [visitOf(item)], pending: eventsOf(item), actor })

      expect(outcomeOf(projected.visits[0] as Visit)).toEqual(item.expect.visit)
      expect(
        projected.rejected.map(({ clientEventId, code }) => ({
          event: Number(clientEventId.slice(1)),
          code,
        })),
      ).toEqual(item.expect.rejected)
    })
  })
})
