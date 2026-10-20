import { describe, expect, it } from 'vitest'
import { DomainError } from './errors'
import { assertCan, can, PERMISSION_MATRIX } from './permissions'
import { ana, bruno, leader } from './testing'

describe('permissões', () => {
  /**
   * Esta tabela é duplicada de propósito. Quem mudar PERMISSION_MATRIX precisa
   * mudar aqui (e nas políticas de RLS + testes pgTAP) conscientemente.
   */
  it('a matriz de permissões é a combinada', () => {
    expect(PERMISSION_MATRIX).toEqual({
      repositor: {
        view: 'own',
        executeVisit: 'own',
        editPlan: 'own',
        editStandardRoute: 'own',
        reopenVisit: 'none',
        viewAudit: 'none',
        manageMarkets: 'all',
      },
      leader: {
        view: 'all',
        executeVisit: 'all',
        editPlan: 'all',
        editStandardRoute: 'all',
        reopenVisit: 'all',
        viewAudit: 'all',
        manageMarkets: 'all',
      },
    })
  })

  it('repositor A não enxerga nem edita o que é do repositor B', () => {
    const bruno_visit = { repositorId: bruno.id }
    expect(can(ana, 'view', bruno_visit)).toBe(false)
    expect(can(ana, 'executeVisit', bruno_visit)).toBe(false)
    expect(can(ana, 'editPlan', bruno_visit)).toBe(false)
    expect(can(ana, 'view', { repositorId: ana.id })).toBe(true)
  })

  it('escopo "own" sem informar de quem é o recurso é negado', () => {
    expect(can(ana, 'view')).toBe(false)
  })

  it('repositor nunca reabre visita nem lê o log de auditoria', () => {
    expect(can(ana, 'reopenVisit', { repositorId: ana.id })).toBe(false)
    expect(can(ana, 'viewAudit')).toBe(false)
  })

  it('o líder pode tudo', () => {
    for (const action of Object.keys(
      PERMISSION_MATRIX.leader,
    ) as (keyof typeof PERMISSION_MATRIX.leader)[]) {
      expect(can(leader, action)).toBe(true)
    }
  })

  it('assertCan lança FORBIDDEN quando não pode e não faz nada quando pode', () => {
    expect(() => assertCan(leader, 'viewAudit')).not.toThrow()
    expect(() => assertCan(ana, 'viewAudit')).toThrow(DomainError)
    expect(() => assertCan(ana, 'viewAudit')).toThrow(/não pode/)
  })
})
