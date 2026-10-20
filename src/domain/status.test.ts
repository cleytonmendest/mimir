import { describe, expect, it } from 'vitest'
import { DomainError } from './errors'
import { evaluateTransition, transition, type ExecutionEvent } from './status'
import { VISIT_STATUSES, type Actor, type VisitStatus } from './types'
import { ana, bruno, deepFreeze, leader, makeVisit } from './testing'

const TODAY = '2026-10-20'
const T0 = '2026-10-20T12:00:00.000Z'
const T1 = '2026-10-20T12:45:00.000Z'

function ctx(actor: Actor = ana, now = T0, today = TODAY) {
  return { actor, now, today }
}

function codeOf(run: () => unknown) {
  try {
    run()
  } catch (error) {
    if (error instanceof DomainError) return error.code
    throw error
  }
  return null
}

describe('transições de status da visita', () => {
  describe('check-in', () => {
    it('planejada → em andamento, guardando o horário', () => {
      const visit = deepFreeze(makeVisit({ date: TODAY }))
      expect(transition(visit, { type: 'checkIn' }, ctx())).toMatchObject({
        status: 'in_progress',
        checkInAt: T0,
      })
    })

    it('não deixa fazer check-in em visita de dia futuro', () => {
      const visit = makeVisit({ date: '2026-10-21' })
      expect(codeOf(() => transition(visit, { type: 'checkIn' }, ctx()))).toBe('VISIT_IN_FUTURE')
    })

    it.each(VISIT_STATUSES.filter((status) => status !== 'planned'))(
      'não existe check-in a partir de "%s"',
      (status) => {
        const visit = makeVisit({ date: TODAY, status })
        expect(codeOf(() => transition(visit, { type: 'checkIn' }, ctx()))).toBe(
          'INVALID_TRANSITION',
        )
      },
    )
  })

  describe('check-out', () => {
    const open = makeVisit({ date: TODAY, status: 'in_progress', checkInAt: T0 })

    it('em andamento → feita, com horário e observação', () => {
      expect(
        transition(open, { type: 'checkOut', note: 'Gôndola ok' }, ctx(ana, T1)),
      ).toMatchObject({
        status: 'done',
        checkOutAt: T1,
        note: 'Gôndola ok',
      })
    })

    it('sem observação nova, mantém a que já existia', () => {
      const withNote = { ...open, note: 'antes' }
      expect(transition(withNote, { type: 'checkOut' }, ctx(ana, T1)).note).toBe('antes')
    })

    it('não existe check-out sem check-in', () => {
      const planned = makeVisit({ date: TODAY })
      expect(codeOf(() => transition(planned, { type: 'checkOut' }, ctx(ana, T1)))).toBe(
        'INVALID_TRANSITION',
      )
    })

    it('check-out não pode ser antes do check-in', () => {
      expect(
        codeOf(() => transition(open, { type: 'checkOut' }, ctx(ana, '2026-10-20T11:59:59.000Z'))),
      ).toBe('CHECKOUT_BEFORE_CHECKIN')
    })

    it('em andamento sem horário de entrada (dado corrompido) também é recusado', () => {
      const corrupt = makeVisit({ date: TODAY, status: 'in_progress', checkInAt: null })
      expect(codeOf(() => transition(corrupt, { type: 'checkOut' }, ctx(ana, T1)))).toBe(
        'CHECKOUT_BEFORE_CHECKIN',
      )
    })
  })

  describe('não foi', () => {
    it('planejada → não foi, com motivo sem espaços nas pontas', () => {
      const visit = makeVisit({ date: TODAY })
      expect(
        transition(visit, { type: 'markNotDone', reason: '  Mercado fechado ' }, ctx()),
      ).toMatchObject({ status: 'not_done', skipReason: 'Mercado fechado' })
    })

    it('em andamento também pode virar não foi', () => {
      const visit = makeVisit({ date: TODAY, status: 'in_progress', checkInAt: T0 })
      expect(transition(visit, { type: 'markNotDone', reason: 'Sem estoque' }, ctx()).status).toBe(
        'not_done',
      )
    })

    it.each(['', '   '])('exige motivo (recebeu "%s")', (reason) => {
      const visit = makeVisit({ date: TODAY })
      expect(codeOf(() => transition(visit, { type: 'markNotDone', reason }, ctx()))).toBe(
        'REASON_REQUIRED',
      )
    })

    it('não marca "não foi" em dia futuro (para isso existe cancelar)', () => {
      const visit = makeVisit({ date: '2026-10-22' })
      expect(codeOf(() => transition(visit, { type: 'markNotDone', reason: 'x' }, ctx()))).toBe(
        'VISIT_IN_FUTURE',
      )
    })
  })

  describe('visita encerrada não volta sozinha', () => {
    const events: ExecutionEvent[] = [
      { type: 'checkIn' },
      { type: 'checkOut' },
      { type: 'markNotDone', reason: 'x' },
    ]
    const closed: VisitStatus[] = ['done', 'not_done', 'cancelled']

    it.each(
      closed.flatMap((status) => events.map((event) => [status, event.type, event] as const)),
    )('"%s" + %s é recusado (só o líder reabre, em plan.ts)', (status, _type, event) => {
      const visit = makeVisit({ date: TODAY, status })
      expect(codeOf(() => transition(visit, event, ctx(leader)))).toBe('INVALID_TRANSITION')
    })
  })

  describe('quem pode executar', () => {
    it('o repositor só executa as próprias visitas', () => {
      const visit = makeVisit({ date: TODAY, repositorId: ana.id })
      expect(codeOf(() => transition(visit, { type: 'checkIn' }, ctx(bruno)))).toBe('FORBIDDEN')
    })

    it('o líder executa qualquer uma', () => {
      const visit = makeVisit({ date: TODAY })
      expect(transition(visit, { type: 'checkIn' }, ctx(leader)).status).toBe('in_progress')
    })
  })

  it('evaluateTransition devolve o motivo em vez de lançar', () => {
    const visit = makeVisit({ date: TODAY, status: 'done' })
    expect(evaluateTransition(visit, { type: 'checkIn' }, ctx())).toMatchObject({
      ok: false,
      code: 'INVALID_TRANSITION',
    })
  })
})
