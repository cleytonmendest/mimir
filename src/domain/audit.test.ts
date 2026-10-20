import { describe, expect, it } from 'vitest'
import { buildAuditEntry } from './audit'
import { leader, makeVisit } from './testing'

const at = '2026-10-20T12:00:00.000Z'

describe('log de auditoria', () => {
  it('criação: registra todos os campos, com "de" nulo', () => {
    const after = makeVisit()
    const entry = buildAuditEntry({ actor: leader, at, before: null, after })

    expect(entry).toMatchObject({
      kind: 'create',
      actorId: leader.id,
      actorRole: 'leader',
      at,
      visitId: after.id,
    })
    expect(entry?.changes['status']).toEqual({ from: null, to: 'planned' })
  })

  it('alteração: registra só o que mudou, com antes e depois', () => {
    const before = makeVisit()
    const after = { ...before, status: 'cancelled' as const, order: 7 }
    const entry = buildAuditEntry({ actor: leader, at, before, after })

    expect(entry?.kind).toBe('update')
    expect(entry?.changes).toEqual({
      status: { from: 'planned', to: 'cancelled' },
      order: { from: 0, to: 7 },
    })
  })

  it('nada mudou: não há entrada de log', () => {
    const visit = makeVisit()
    expect(buildAuditEntry({ actor: leader, at, before: visit, after: { ...visit } })).toBeNull()
  })
})
