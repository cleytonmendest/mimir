import { describe, expect, it, vi } from 'vitest'
import { applyOfflineEvents, type OfflineEvent } from './sync'
import { ana, bruno, deepFreeze, makeVisit } from './testing'

const TODAY = '2026-10-20'
const visit = deepFreeze(makeVisit({ id: 'v1', date: TODAY }))

const checkIn: OfflineEvent = {
  clientEventId: 'e1',
  visitId: 'v1',
  occurredAt: '2026-10-20T12:00:00.000Z',
  occurredLocalDate: TODAY,
  type: 'checkIn',
}
const checkOut: OfflineEvent = {
  clientEventId: 'e2',
  visitId: 'v1',
  occurredAt: '2026-10-20T12:40:00.000Z',
  occurredLocalDate: TODAY,
  type: 'checkOut',
  note: 'Tudo certo',
}

function sync(events: OfflineEvent[], alreadyApplied: string[] = [], target = visit, actor = ana) {
  return applyOfflineEvents({
    visit: target,
    events,
    alreadyApplied: new Set(alreadyApplied),
    actor,
  })
}

describe('sincronização de eventos offline', () => {
  it('aplica na ordem em que aconteceu, mesmo que cheguem invertidos', () => {
    const result = sync([checkOut, checkIn])
    expect(result.applied).toEqual(['e1', 'e2'])
    expect(result.visit).toMatchObject({
      status: 'done',
      checkInAt: checkIn.occurredAt,
      checkOutAt: checkOut.occurredAt,
      note: 'Tudo certo',
    })
  })

  it('usa a hora em que o evento aconteceu, não a hora da sincronização', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T03:00:00.000Z'))
    try {
      expect(sync([checkIn]).visit.checkInAt).toBe(checkIn.occurredAt)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reenviar o mesmo lote não duplica nem muda nada (idempotente)', () => {
    const first = sync([checkIn, checkOut])
    const replay = sync([checkIn, checkOut], first.applied, first.visit)

    expect(replay.applied).toEqual([])
    expect(replay.duplicates.sort()).toEqual(['e1', 'e2'])
    expect(replay.visit).toEqual(first.visit)
  })

  it('o mesmo evento duas vezes dentro do lote conta uma vez só', () => {
    const result = sync([checkIn, checkIn])
    expect(result.applied).toEqual(['e1'])
    expect(result.duplicates).toEqual(['e1'])
  })

  it('se o líder cancelou enquanto estava offline, o evento é recusado e o servidor vence', () => {
    const cancelled = makeVisit({ id: 'v1', date: TODAY, status: 'cancelled' })
    const result = sync([checkIn], [], cancelled)

    expect(result.applied).toEqual([])
    expect(result.rejected).toEqual([{ clientEventId: 'e1', code: 'INVALID_TRANSITION' }])
    expect(result.visit.status).toBe('cancelled')
  })

  it('um evento recusado não impede os seguintes de serem aplicados', () => {
    const invalid: OfflineEvent = {
      clientEventId: 'e0',
      visitId: 'v1',
      occurredAt: '2026-10-20T11:00:00.000Z',
      occurredLocalDate: TODAY,
      type: 'markNotDone',
      reason: '  ',
    }
    const result = sync([checkIn, invalid])
    expect(result.rejected).toEqual([{ clientEventId: 'e0', code: 'REASON_REQUIRED' }])
    expect(result.applied).toEqual(['e1'])
    expect(result.visit.status).toBe('in_progress')
  })

  it('evento de outra visita é recusado', () => {
    const result = sync([{ ...checkIn, visitId: 'outra' }])
    expect(result.rejected).toEqual([{ clientEventId: 'e1', code: 'VISIT_NOT_FOUND' }])
    expect(result.visit).toEqual(visit)
  })

  it('evento de outro repositor é recusado', () => {
    const result = sync([checkIn], [], visit, bruno)
    expect(result.rejected).toEqual([{ clientEventId: 'e1', code: 'FORBIDDEN' }])
  })

  it('usa a data local do aparelho para saber se a visita já era de hoje', () => {
    const early = { ...checkIn, occurredLocalDate: '2026-10-19' }
    expect(sync([early]).rejected).toEqual([{ clientEventId: 'e1', code: 'VISIT_IN_FUTURE' }])
  })
})
