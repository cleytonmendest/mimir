import fc from 'fast-check'
import { describe, expect, it, vi } from 'vitest'
import { applyOfflineEvents, type OfflineEvent } from './sync'
import { ana, bruno, deepFreeze, makeVisit } from './testing'

const TODAY = '2026-10-20'
const visit = deepFreeze(makeVisit({ id: 'v1', date: TODAY }))

const checkIn: OfflineEvent = {
  clientEventId: 'e1',
  seq: 1,
  visitId: 'v1',
  occurredAt: '2026-10-20T12:00:00.000Z',
  type: 'checkIn',
}
const checkOut: OfflineEvent = {
  clientEventId: 'e2',
  seq: 2,
  visitId: 'v1',
  occurredAt: '2026-10-20T12:40:00.000Z',
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
  it('aplica na ordem do aparelho (seq), mesmo que cheguem invertidos', () => {
    const result = sync([checkOut, checkIn])
    expect(result.applied).toEqual(['e1', 'e2'])
    expect(result.visit).toMatchObject({
      status: 'done',
      checkInAt: checkIn.occurredAt,
      checkOutAt: checkOut.occurredAt,
      note: 'Tudo certo',
    })
  })

  it('a ordem é a do seq, não a de occurredAt: relógio corrigido no meio do dia não troca a ordem', () => {
    // O "não fui" foi registrado primeiro (seq 1), com o relógio adiantado; o check-in veio depois
    // (seq 2), com o relógio já certo, e por isso carrega uma hora anterior.
    const notDone: OfflineEvent = {
      clientEventId: 'e1',
      seq: 1,
      visitId: 'v1',
      occurredAt: '2026-10-20T13:00:00.000Z',
      type: 'markNotDone',
      reason: 'Mercado fechado',
    }
    const late: OfflineEvent = {
      ...checkIn,
      clientEventId: 'e2',
      seq: 2,
      occurredAt: '2026-10-20T11:00:00.000Z',
    }
    const result = sync([late, notDone])

    expect(result.applied).toEqual(['e1'])
    expect(result.rejected).toEqual([{ clientEventId: 'e2', code: 'INVALID_TRANSITION' }])
    expect(result.visit).toMatchObject({ status: 'not_done', checkInAt: null })
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
      seq: 0,
      visitId: 'v1',
      occurredAt: '2026-10-20T11:00:00.000Z',
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

  describe('o dia do evento é o da empresa, calculado a partir do instante', () => {
    it('23h59 de Brasília ainda é o dia anterior: a visita de "hoje" ainda é futura', () => {
      const result = sync([{ ...checkIn, occurredAt: '2026-10-20T02:59:59.000Z' }])
      expect(result.rejected).toEqual([{ clientEventId: 'e1', code: 'VISIT_IN_FUTURE' }])
    })

    it('00h00 de Brasília já é o dia seguinte', () => {
      const result = sync([{ ...checkIn, occurredAt: '2026-10-20T03:00:00.000Z' }])
      expect(result.applied).toEqual(['e1'])
    })

    it('depois da meia-noite de Brasília a visita de ontem não pode mais ser iniciada', () => {
      const result = sync([{ ...checkIn, occurredAt: '2026-10-21T03:00:00.000Z' }])
      expect(result.rejected).toEqual([{ clientEventId: 'e1', code: 'VISIT_IN_PAST' }])
    })
  })

  it('instante inválido é recusado sem derrubar o lote', () => {
    const broken = { ...checkIn, occurredAt: 'ontem à tarde' }
    const result = sync([broken, { ...checkOut, seq: 3 }])

    expect(result.rejected).toEqual([
      { clientEventId: 'e1', code: 'INVALID_DATE' },
      { clientEventId: 'e2', code: 'INVALID_TRANSITION' },
    ])
  })

  describe('propriedades', () => {
    const EVENTS = [checkIn, checkOut]

    it('a ordem de chegada do lote não muda o resultado (só o seq conta)', () => {
      fc.assert(
        fc.property(fc.shuffledSubarray(EVENTS), (batch) => {
          const arrival = sync(batch)
          const bySeq = sync([...batch].sort((a, b) => a.seq - b.seq))
          expect(arrival).toEqual(bySeq)
        }),
      )
    })

    it('reenviar o que já foi aplicado nunca muda a visita', () => {
      fc.assert(
        fc.property(fc.shuffledSubarray(EVENTS), (batch) => {
          const first = sync(batch)
          const replay = sync(batch, first.applied, first.visit)
          expect(replay.visit).toEqual(first.visit)
          expect(replay.applied).toEqual([])
        }),
      )
    })
  })
})
