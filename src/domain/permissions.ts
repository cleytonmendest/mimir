import { DomainError } from './errors'
import type { Actor, Role } from './types'

export type Action =
  | 'view'
  | 'executeVisit'
  | 'editPlan'
  | 'editStandardRoute'
  | 'reopenVisit'
  | 'viewAudit'
  | 'manageMarkets'

/** all = qualquer repositor, own = só o que é dele, none = nunca. */
export type Scope = 'all' | 'own' | 'none'

/**
 * Fonte única de verdade de quem pode o quê. As políticas de RLS do banco
 * (supabase/migrations) espelham esta tabela; o teste de snapshot em
 * permissions.test.ts impede mudar uma sem perceber.
 */
export const PERMISSION_MATRIX: Record<Role, Record<Action, Scope>> = {
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
}

export function can(actor: Actor, action: Action, resource?: { repositorId: string }): boolean {
  const scope = PERMISSION_MATRIX[actor.role][action]
  if (scope === 'all') return true
  if (scope === 'none') return false
  return resource !== undefined && resource.repositorId === actor.id
}

export function assertCan(actor: Actor, action: Action, resource?: { repositorId: string }): void {
  if (!can(actor, action, resource)) {
    throw new DomainError('FORBIDDEN', `${actor.role} não pode executar "${action}"`)
  }
}
