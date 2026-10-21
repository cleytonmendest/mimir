import { applyOfflineEvents, type OfflineEvent, type SyncResult } from './sync'
import type { Actor, Visit } from './types'

export interface Projection {
  /** As visitas como o repositor as vê: o que o servidor disse, mais o que ele já fez e ainda não enviou. */
  visits: Visit[]
  /** Eventos pendentes que não se aplicam à cópia atual (ficam de fora da tela). Sem ordem garantida. */
  rejected: SyncResult['rejected']
}

/**
 * A tela do repositor sem rede: a cópia que veio do servidor com os eventos pendentes aplicados por
 * cima, pelas mesmas regras do servidor. Função pura: não grava nada, e a ordem das visitas é a da
 * entrada. Um evento que a cópia não aceita (a visita já avançou no servidor, por exemplo) é
 * ignorado aqui e listado em `rejected`; quem decide o destino dele é o servidor, ao sincronizar.
 */
export function projectVisits(input: {
  visits: readonly Visit[]
  pending: readonly OfflineEvent[]
  actor: Actor
}): Projection {
  const { visits, pending, actor } = input

  const byVisit = new Map<string, OfflineEvent[]>()
  for (const event of pending) {
    byVisit.set(event.visitId, [...(byVisit.get(event.visitId) ?? []), event])
  }

  const known = new Set(visits.map((visit) => visit.id))
  const rejected: Projection['rejected'] = pending
    .filter((event) => !known.has(event.visitId))
    .map((event) => ({ clientEventId: event.clientEventId, code: 'VISIT_NOT_FOUND' }))

  const projected = visits.map((visit) => {
    const events = byVisit.get(visit.id)
    if (events === undefined) return visit
    const result = applyOfflineEvents({ visit, events, alreadyApplied: new Set(), actor })
    rejected.push(...result.rejected)
    return result.visit
  })

  return { visits: projected, rejected }
}
