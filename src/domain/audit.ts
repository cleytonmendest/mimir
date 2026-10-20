import type { Actor, Role, Visit } from './types'

export interface AuditChange {
  from: unknown
  to: unknown
}

export interface AuditEntry {
  at: string
  actorId: string
  actorRole: Role
  visitId: string
  kind: 'create' | 'update'
  changes: Record<string, AuditChange>
}

/** Devolve null quando nada mudou: não existe log de "nada aconteceu". */
export function buildAuditEntry(input: {
  actor: Actor
  at: string
  before: Visit | null
  after: Visit
}): AuditEntry | null {
  const { actor, at, before, after } = input
  const changes: Record<string, AuditChange> = {}

  for (const field of Object.keys(after) as (keyof Visit)[]) {
    const from = before === null ? null : before[field]
    if (before === null || from !== after[field]) {
      changes[field] = { from, to: after[field] }
    }
  }

  if (Object.keys(changes).length === 0) return null

  return {
    at,
    actorId: actor.id,
    actorRole: actor.role,
    visitId: after.id,
    kind: before === null ? 'create' : 'update',
    changes,
  }
}
