import type { DomainErrorCode } from './errors'
import { evaluateTransition, type ExecutionEvent } from './status'
import type { Actor, IsoDate, Visit } from './types'

/** Evento registrado no celular (talvez sem sinal) e enviado depois. */
export type OfflineEvent = {
  /** Gerado no aparelho. É a chave que torna o reenvio inofensivo. */
  clientEventId: string
  visitId: string
  /** Quando aconteceu de verdade, não quando sincronizou. */
  occurredAt: string
  /** Data local do aparelho quando aconteceu. */
  occurredLocalDate: IsoDate
} & ExecutionEvent

export interface SyncResult {
  visit: Visit
  applied: string[]
  duplicates: string[]
  rejected: { clientEventId: string; code: DomainErrorCode }[]
}

/**
 * Aplica eventos offline numa visita.
 * - repetidos (já aplicados antes, ou duas vezes no mesmo lote) são ignorados;
 * - a ordem é a do acontecimento, não a da chegada;
 * - se o servidor já mudou (ex.: líder cancelou), o evento é recusado e o servidor vence.
 */
export function applyOfflineEvents(input: {
  visit: Visit
  events: readonly OfflineEvent[]
  alreadyApplied: ReadonlySet<string>
  actor: Actor
}): SyncResult {
  const { actor } = input
  const seen = new Set(input.alreadyApplied)
  const result: SyncResult = { visit: input.visit, applied: [], duplicates: [], rejected: [] }

  const ordered = [...input.events].sort(
    (a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt),
  )

  for (const event of ordered) {
    if (event.visitId !== result.visit.id) {
      result.rejected.push({ clientEventId: event.clientEventId, code: 'VISIT_NOT_FOUND' })
      continue
    }
    if (seen.has(event.clientEventId)) {
      result.duplicates.push(event.clientEventId)
      continue
    }
    seen.add(event.clientEventId)

    const outcome = evaluateTransition(result.visit, event, {
      actor,
      now: event.occurredAt,
      today: event.occurredLocalDate,
    })
    if (outcome.ok) {
      result.visit = outcome.visit
      result.applied.push(event.clientEventId)
    } else {
      result.rejected.push({ clientEventId: event.clientEventId, code: outcome.code })
    }
  }

  return result
}
