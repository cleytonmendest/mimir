import { DomainError } from './errors'
import type { Actor, Role } from './types'

export type Action =
  | 'viewAvailability'
  | 'book'
  | 'cancelBooking'
  | 'viewBookings'
  | 'manageMarkets'
  | 'manageClosedDays'
  | 'manageSuppliers'
  | 'manageSettings'
  | 'viewAudit'

/** all = qualquer fornecedor, own = só o que é dele, none = nunca. */
export type Scope = 'all' | 'own' | 'none'

/**
 * Fonte única de verdade de quem pode o quê. As políticas de RLS do banco
 * (supabase/migrations) espelham esta tabela; o teste de snapshot em
 * permissions.test.ts impede mudar uma sem perceber.
 *
 * `viewAvailability` é só contagem de vagas por dia. Quem reservou (os nomes) é `viewBookings`,
 * e o fornecedor só vê as próprias reservas.
 */
export const PERMISSION_MATRIX: Record<Role, Record<Action, Scope>> = {
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
}

export function can(actor: Actor, action: Action, resource?: { supplierId: string }): boolean {
  const scope = PERMISSION_MATRIX[actor.role][action]
  if (scope === 'all') return true
  if (scope === 'none') return false
  return resource !== undefined && resource.supplierId === actor.id
}

export function assertCan(actor: Actor, action: Action, resource?: { supplierId: string }): void {
  if (!can(actor, action, resource)) {
    throw new DomainError('FORBIDDEN', `${actor.role} não pode executar "${action}"`)
  }
}
