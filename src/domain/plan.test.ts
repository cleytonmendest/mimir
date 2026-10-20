import { describe, expect, it } from 'vitest'
import { DomainError } from './errors'
import {
  addVisit,
  cancelVisit,
  moveVisitToDate,
  reopenVisit,
  reorderVisit,
  type PlanContext,
} from './plan'
import type { Actor, Visit } from './types'
import { ana, bruno, deepFreeze, idGenerator, leader, makeVisit } from './testing'

const NOW = '2026-10-20T12:00:00.000Z'
const TODAY = '2026-10-20'

function ctx(actor: Actor = leader): PlanContext {
  return { actor, now: NOW, today: TODAY, newId: idGenerator('new') }
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

const standard = makeVisit({
  id: 'v1',
  marketId: 'market-a',
  date: '2026-10-21',
  origin: 'standard',
})
const base = deepFreeze([standard])

describe('exceções no plano', () => {
  describe('addVisit', () => {
    it('cria visita planejada com origem "exception" e registra a criação', () => {
      const result = addVisit(
        base,
        { repositorId: ana.id, marketId: 'market-x', date: '2026-10-22', order: 3 },
        ctx(),
      )
      const created = result.visits.find((visit) => visit.marketId === 'market-x')
      expect(created).toMatchObject({
        status: 'planned',
        origin: 'exception',
        order: 3,
        id: 'new-1',
      })
      expect(result.audit).toHaveLength(1)
      expect(result.audit[0]).toMatchObject({
        kind: 'create',
        actorId: leader.id,
        visitId: 'new-1',
      })
      expect(result.visits).toHaveLength(2)
    })

    it('o repositor adiciona nas próprias visitas, mas não nas de outro', () => {
      const input = { repositorId: ana.id, marketId: 'market-x', date: '2026-10-22', order: 0 }
      expect(addVisit(base, input, ctx(ana)).visits).toHaveLength(2)
      expect(codeOf(() => addVisit(base, input, ctx(bruno)))).toBe('FORBIDDEN')
    })

    it('recusa mercado repetido no mesmo dia', () => {
      const input = { repositorId: ana.id, marketId: 'market-a', date: '2026-10-21', order: 1 }
      expect(codeOf(() => addVisit(base, input, ctx()))).toBe('DUPLICATE_VISIT')
    })

    it('se havia uma visita cancelada no mesmo dia, ela volta em vez de duplicar', () => {
      const cancelled = deepFreeze([{ ...standard, status: 'cancelled' as const }])
      const result = addVisit(
        cancelled,
        { repositorId: ana.id, marketId: 'market-a', date: '2026-10-21', order: 4 },
        ctx(),
      )
      expect(result.visits).toHaveLength(1)
      expect(result.visits[0]).toMatchObject({
        id: 'v1',
        status: 'planned',
        origin: 'exception',
        order: 4,
      })
      expect(result.audit[0]?.kind).toBe('update')
    })

    it('não planeja dia que já passou', () => {
      const input = { repositorId: ana.id, marketId: 'market-x', date: '2026-10-19', order: 0 }
      expect(codeOf(() => addVisit(base, input, ctx()))).toBe('VISIT_NOT_EDITABLE')
    })
  })

  describe('reorderVisit', () => {
    it('muda a ordem e registra só o campo que mudou', () => {
      const result = reorderVisit(base, 'v1', 5, ctx())
      expect(result.visits[0]?.order).toBe(5)
      expect(result.audit).toHaveLength(1)
      expect(Object.keys(result.audit[0]?.changes ?? {})).toEqual(['order'])
    })

    it('mesma ordem não muda nada e não gera log', () => {
      expect(reorderVisit(base, 'v1', 0, ctx()).audit).toEqual([])
    })

    it('recusa visita inexistente', () => {
      expect(codeOf(() => reorderVisit(base, 'nope', 1, ctx()))).toBe('VISIT_NOT_FOUND')
    })

    it('recusa mexer na visita de outro repositor', () => {
      expect(codeOf(() => reorderVisit(base, 'v1', 1, ctx(bruno)))).toBe('FORBIDDEN')
    })

    it('recusa mexer em visita que já começou ou terminou', () => {
      for (const status of ['in_progress', 'done', 'not_done', 'cancelled'] as const) {
        const visits = [{ ...standard, status }]
        expect(codeOf(() => reorderVisit(visits, 'v1', 1, ctx()))).toBe('VISIT_NOT_EDITABLE')
      }
    })

    it('recusa mexer em dia que já passou', () => {
      const past = [{ ...standard, date: '2026-10-19' }]
      expect(codeOf(() => reorderVisit(past, 'v1', 1, ctx()))).toBe('VISIT_NOT_EDITABLE')
    })
  })

  describe('cancelVisit', () => {
    it('planejada → cancelada', () => {
      const result = cancelVisit(base, 'v1', ctx())
      expect(result.visits[0]?.status).toBe('cancelled')
    })

    it('não cancela o que já começou ou terminou', () => {
      for (const status of ['in_progress', 'done'] as const) {
        expect(codeOf(() => cancelVisit([{ ...standard, status }], 'v1', ctx()))).toBe(
          'VISIT_NOT_EDITABLE',
        )
      }
    })
  })

  describe('moveVisitToDate', () => {
    it('visita da rota padrão: deixa uma cancelada na origem e cria a nova no destino', () => {
      const result = moveVisitToDate(base, 'v1', { date: '2026-10-23', order: 2 }, ctx())

      const origin = result.visits.find((visit) => visit.id === 'v1')
      const arrival = result.visits.find((visit) => visit.id === 'new-1')
      expect(origin).toMatchObject({ status: 'cancelled', date: '2026-10-21' })
      expect(arrival).toMatchObject({
        status: 'planned',
        origin: 'exception',
        date: '2026-10-23',
        order: 2,
        marketId: 'market-a',
      })
      expect(result.audit).toHaveLength(2)
    })

    it('visita avulsa (exceção) simplesmente muda de data, sem deixar rastro cancelado', () => {
      const loose = deepFreeze([{ ...standard, origin: 'exception' as const }])
      const result = moveVisitToDate(loose, 'v1', { date: '2026-10-23', order: 0 }, ctx())
      expect(result.visits).toHaveLength(1)
      expect(result.visits[0]).toMatchObject({ id: 'v1', date: '2026-10-23', status: 'planned' })
      expect(result.audit).toHaveLength(1)
    })

    it('se o destino tem a mesma visita cancelada, ela volta (sem violar a chave única do dia)', () => {
      const parked: Visit = { ...standard, id: 'v2', date: '2026-10-23', status: 'cancelled' }
      const visits = deepFreeze([standard, parked])
      const result = moveVisitToDate(visits, 'v1', { date: '2026-10-23', order: 1 }, ctx())

      expect(result.visits).toHaveLength(2)
      expect(result.visits.find((visit) => visit.id === 'v1')?.status).toBe('cancelled')
      expect(result.visits.find((visit) => visit.id === 'v2')).toMatchObject({
        status: 'planned',
        origin: 'exception',
        order: 1,
      })
    })

    it('recusa quando o destino já tem esse mercado ativo', () => {
      const busy: Visit = { ...standard, id: 'v2', date: '2026-10-23' }
      expect(
        codeOf(() =>
          moveVisitToDate([standard, busy], 'v1', { date: '2026-10-23', order: 0 }, ctx()),
        ),
      ).toBe('DUPLICATE_VISIT')
    })

    it('mesmo dia vira simples reordenação', () => {
      const result = moveVisitToDate(base, 'v1', { date: '2026-10-21', order: 9 }, ctx())
      expect(result.visits).toHaveLength(1)
      expect(result.visits[0]?.order).toBe(9)
    })

    it('não remaneja para o passado', () => {
      expect(
        codeOf(() => moveVisitToDate(base, 'v1', { date: '2026-10-19', order: 0 }, ctx())),
      ).toBe('VISIT_NOT_EDITABLE')
    })
  })

  describe('reopenVisit', () => {
    it.each([
      ['done', { checkInAt: '2026-10-20T10:00:00.000Z', checkOutAt: '2026-10-20T11:00:00.000Z' }],
      ['not_done', { skipReason: 'Fechado' }],
      ['cancelled', {}],
    ] as const)('o líder reabre visita "%s" e limpa horários e motivo', (status, extra) => {
      const visits = [{ ...standard, status, ...extra }]
      const result = reopenVisit(visits, 'v1', ctx())
      expect(result.visits[0]).toMatchObject({
        status: 'planned',
        checkInAt: null,
        checkOutAt: null,
        skipReason: null,
      })
      expect(result.audit).toHaveLength(1)
    })

    it('repositor não reabre nem a própria visita', () => {
      const visits = [{ ...standard, status: 'done' as const }]
      expect(codeOf(() => reopenVisit(visits, 'v1', ctx(ana)))).toBe('FORBIDDEN')
    })

    it('não há o que reabrir em visita planejada ou em andamento', () => {
      for (const status of ['planned', 'in_progress'] as const) {
        expect(codeOf(() => reopenVisit([{ ...standard, status }], 'v1', ctx()))).toBe(
          'INVALID_TRANSITION',
        )
      }
    })

    it('recusa visita inexistente', () => {
      expect(codeOf(() => reopenVisit(base, 'nope', ctx()))).toBe('VISIT_NOT_FOUND')
    })
  })
})
