import { applyOfflineEvents, type OfflineEvent } from '@/domain/sync'
import type { Actor, Visit } from '@/domain/types'
import { SyncFailure } from '@/lib/supabase/errors'
import type { SyncGateway } from '@/lib/supabase/sync-gateway'
import type { EventResult, SyncResponse } from '@/lib/supabase/sync-wire'

/** Apoio só para testes e stories. Não importar em código de produção. */

/** Como a rede se comporta no próximo pedido (depois disso, volta a "ok"). */
export type Fault = 'ok' | 'dropBefore' | 'dropAfter' | 'duplicate'

/**
 * A função do servidor (`sync_visit_events_v1`) em miniatura, sobre uma lista de visitas que o teste
 * também enxerga: mesmas regras do domínio, e idempotente por id de evento (reenviar um evento já
 * decidido devolve a decisão guardada, sem aplicar de novo).
 */
export function createFakeSyncGateway(
  visits: Visit[],
  options: {
    actor: Actor
    /** Falhas para os próximos pedidos, uma por pedido. */
    faults?: readonly Fault[]
    /** Sem rede, todo pedido falha antes de chegar ao servidor. */
    isOnline?: () => boolean
  },
) {
  const faults = [...(options.faults ?? [])]
  const decisions = new Map<string, { status: 'applied' | 'rejected'; code: string | null }>()
  const timesApplied = new Map<string, number>()
  const calls: string[][] = []

  function resultFor(
    event: OfflineEvent,
    decision: { status: 'applied' | 'rejected'; code: string | null },
    visit: Visit,
    duplicate: boolean,
  ): EventResult {
    return {
      clientEventId: event.clientEventId,
      visitId: visit.id,
      status: decision.status,
      code: decision.status === 'rejected' ? 'INVALID_TRANSITION' : null,
      visitStatus: visit.status,
      duplicate,
    }
  }

  function process(events: readonly OfflineEvent[]): SyncResponse {
    const results: EventResult[] = []
    const touched = new Set<string>()
    for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
      const index = visits.findIndex((candidate) => candidate.id === event.visitId)
      const visit = visits[index]
      if (visit === undefined)
        throw new Error(`visita ${event.visitId} não existe no servidor falso`)
      touched.add(visit.id)

      const known = decisions.get(event.clientEventId)
      if (known !== undefined) {
        results.push(resultFor(event, known, visit, true))
        continue
      }
      const outcome = applyOfflineEvents({
        visit,
        events: [event],
        alreadyApplied: new Set(),
        actor: options.actor,
      })
      const decision =
        outcome.applied.length === 1
          ? { status: 'applied' as const, code: null }
          : { status: 'rejected' as const, code: outcome.rejected[0]?.code ?? null }
      if (decision.status === 'applied') {
        visits[index] = outcome.visit
        timesApplied.set(event.clientEventId, (timesApplied.get(event.clientEventId) ?? 0) + 1)
      }
      decisions.set(event.clientEventId, decision)
      results.push(resultFor(event, decision, visits[index] ?? visit, false))
    }
    return {
      kind: 'synced',
      serverNow: new Date().toISOString(),
      results,
      visits: visits.filter((visit) => touched.has(visit.id)),
    }
  }

  const gateway: SyncGateway = {
    sync: ({ events }) => {
      calls.push(events.map((event) => event.clientEventId))
      if (options.isOnline?.() === false) {
        return Promise.reject(new SyncFailure('NETWORK', 'sem rede'))
      }
      const fault = faults.shift() ?? 'ok'
      if (fault === 'dropBefore') return Promise.reject(new SyncFailure('NETWORK', 'caiu antes'))
      const response = process(events)
      if (fault === 'dropAfter')
        return Promise.reject(new SyncFailure('NETWORK', 'resposta perdida'))
      // A rede entregou o mesmo pedido duas vezes; o aparelho só vê uma resposta.
      if (fault === 'duplicate') process(events)
      return Promise.resolve(response)
    },
  }

  return { gateway, decisions, timesApplied, calls }
}
