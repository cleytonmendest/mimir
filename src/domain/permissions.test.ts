import { describe, expect, it } from 'vitest'
import { DomainError } from './errors'
import { assertCan, can, PERMISSION_MATRIX } from './permissions'
import type { Actor } from './types'

const ana: Actor = { id: 'u-ana', role: 'supplier' }
const bruno: Actor = { id: 'u-bruno', role: 'supplier' }
const lia: Actor = { id: 'u-lia', role: 'admin' }

describe('permissões', () => {
  /**
   * Esta tabela é duplicada de propósito. Quem mudar PERMISSION_MATRIX precisa
   * mudar aqui (e nas políticas de RLS + testes pgTAP) conscientemente.
   */
  it('a matriz de permissões é a combinada', () => {
    expect(PERMISSION_MATRIX).toEqual({
      supplier: {
        viewAvailability: 'all',
        book: 'all',
        cancelBooking: 'own',
        viewBookings: 'own',
        manageMarkets: 'none',
        manageClosedDays: 'none',
        manageSuppliers: 'none',
        manageSettings: 'none',
        viewAudit: 'none',
      },
      admin: {
        viewAvailability: 'all',
        book: 'none',
        cancelBooking: 'all',
        viewBookings: 'all',
        manageMarkets: 'all',
        manageClosedDays: 'all',
        manageSuppliers: 'all',
        manageSettings: 'all',
        viewAudit: 'all',
      },
    })
  })

  it('o fornecedor A não enxerga nem cancela a reserva do fornecedor B', () => {
    const ofBruno = { supplierId: bruno.id }
    expect(can(ana, 'viewBookings', ofBruno)).toBe(false)
    expect(can(ana, 'cancelBooking', ofBruno)).toBe(false)
    expect(can(ana, 'viewBookings', { supplierId: ana.id })).toBe(true)
    expect(can(ana, 'cancelBooking', { supplierId: ana.id })).toBe(true)
  })

  it('escopo "own" sem informar de quem é o recurso é negado', () => {
    expect(can(ana, 'viewBookings')).toBe(false)
  })

  it('o fornecedor vê a disponibilidade e reserva, mas não administra nada', () => {
    expect(can(ana, 'viewAvailability')).toBe(true)
    expect(can(ana, 'book')).toBe(true)
    for (const action of [
      'manageMarkets',
      'manageClosedDays',
      'manageSuppliers',
      'manageSettings',
      'viewAudit',
    ] as const) {
      expect(can(ana, action)).toBe(false)
    }
  })

  it('o administrador administra tudo, mas não reserva estande', () => {
    expect(can(lia, 'book')).toBe(false)
    for (const action of Object.keys(
      PERMISSION_MATRIX.admin,
    ) as (keyof typeof PERMISSION_MATRIX.admin)[]) {
      if (action !== 'book') expect(can(lia, action)).toBe(true)
    }
  })

  it('assertCan lança FORBIDDEN quando não pode e não faz nada quando pode', () => {
    expect(() => assertCan(lia, 'viewAudit')).not.toThrow()
    expect(() => assertCan(ana, 'viewAudit')).toThrow(DomainError)
    expect(() => assertCan(ana, 'viewAudit')).toThrow(/não pode/)
  })
})
