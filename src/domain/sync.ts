import { companyDate } from './dates'
import type { DomainErrorCode } from './errors'
import { evaluateTransition, type ExecutionEvent } from './status'
import type { Actor, Visit } from './types'

/** Evento registrado no celular (talvez sem sinal) e enviado depois. */
export type OfflineEvent = {
  /** Gerado no aparelho. É a chave que torna o reenvio inofensivo. */
  clientEventId: string
  /**
   * Número de ordem no aparelho: cresce a cada evento gravado. É a ordem de aplicação, nunca a de
   * `occurredAt`: o relógio do celular pode ser corrigido no meio do dia.
   */
  seq: number
  visitId: string
  /** Quando aconteceu de verdade, não quando sincronizou. O "dia" do evento sai daqui (ADR 0002). */
  occurredAt: string
  /** Evento que provocou este (o check-out automático nasce de um check-in em outra visita). */
  causedBy?: string
} & ExecutionEvent

export interface SyncResult {
  visit: Visit
  applied: string[]
  duplicates: string[]
  rejected: { clientEventId: string; code: DomainErrorCode }[]
}

/**
 * Aplica eventos offline numa visita. É o gêmeo em TypeScript da função do servidor
 * (`sync_visit_events_v1`); os casos de `fixtures/visit-events.cases.json` valem para os dois.
 * - repetidos (já aplicados antes, ou duas vezes no mesmo lote) são ignorados;
 * - a ordem é a do `seq` do aparelho, não a da chegada nem a de `occurredAt`;
 * - o dia do evento é o da empresa no instante em que aconteceu, não o do aparelho;
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

  const ordered = [...input.events].sort((a, b) => a.seq - b.seq)

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

    if (Number.isNaN(Date.parse(event.occurredAt))) {
      result.rejected.push({ clientEventId: event.clientEventId, code: 'INVALID_DATE' })
      continue
    }

    const outcome = evaluateTransition(result.visit, event, {
      actor,
      now: event.occurredAt,
      today: companyDate(event.occurredAt),
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
