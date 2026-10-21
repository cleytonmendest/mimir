import 'fake-indexeddb/auto'
import fc from 'fast-check'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { checkInEvents, type EventDraft } from '@/domain/execution'
import { projectVisits } from '@/domain/projection'
import { applyOfflineEvents, type OfflineEvent } from '@/domain/sync'
import { ana, makeVisit } from '@/domain/testing'
import type { Visit } from '@/domain/types'
import { openUserStore, type UserStore } from './store'
import { createSyncEngine } from './sync-engine'
import { createFakeSyncGateway, type Fault } from './testing'

/**
 * A garantia central do offline: com um servidor que perde o pedido, perde a resposta depois de
 * gravar e entrega o mesmo pedido duas vezes, e com o app sendo fechado no meio, NADA se perde, nada
 * se aplica duas vezes, a fila esvazia e o resultado é o mesmo de aplicar tudo em sequência, sem falha
 * nenhuma.
 */

const DAY = '2026-03-18'
const START = Date.parse(`${DAY}T12:00:00.000Z`)

type Op =
  | { kind: 'act'; visit: number; action: 'checkIn' | 'checkOut' | 'notDone' }
  | { kind: 'sync' }
  | { kind: 'restart' }

const opArbitrary: fc.Arbitrary<Op> = fc.oneof(
  {
    weight: 5,
    arbitrary: fc.record({
      kind: fc.constant('act' as const),
      visit: fc.nat(2),
      action: fc.constantFrom('checkIn' as const, 'checkOut' as const, 'notDone' as const),
    }),
  },
  { weight: 3, arbitrary: fc.constant<Op>({ kind: 'sync' }) },
  { weight: 1, arbitrary: fc.constant<Op>({ kind: 'restart' }) },
)

const scenarioArbitrary = fc.record({
  visitCount: fc.integer({ min: 1, max: 3 }),
  ops: fc.array(opArbitrary, { maxLength: 25 }),
  faults: fc.array(fc.constantFrom<Fault>('ok', 'dropBefore', 'dropAfter', 'duplicate'), {
    maxLength: 12,
  }),
  batchSize: fc.integer({ min: 1, max: 4 }),
})

/** Gera o que a tela geraria: lê a cópia mais a fila e, a partir dela, decide os eventos. */
async function draftsFor(
  store: UserStore,
  op: Extract<Op, { kind: 'act' }>,
  step: number,
): Promise<EventDraft[]> {
  const view = await store.read()
  if (view.snapshot === null) return []
  const { visits } = projectVisits({
    visits: view.snapshot.visits,
    pending: view.pending,
    actor: ana,
  })
  const target = visits[op.visit % visits.length]
  if (target === undefined) return []

  const occurredAt = new Date(START + step * 60_000).toISOString()
  switch (op.action) {
    case 'checkIn': {
      try {
        const { event, derived } = checkInEvents(visits, target.id, {
          actor: ana,
          now: occurredAt,
          today: DAY,
        })
        return [event, ...derived]
      } catch {
        return []
      }
    }
    case 'checkOut':
      return target.status === 'in_progress'
        ? [{ type: 'checkOut', visitId: target.id, occurredAt, note: 'ok' }]
        : []
    case 'notDone':
      return target.status === 'planned' || target.status === 'in_progress'
        ? [{ type: 'markNotDone', visitId: target.id, occurredAt, reason: 'x' }]
        : []
  }
}

const byId = (a: Visit, b: Visit) => a.id.localeCompare(b.id)

describe('o motor de sincronização diante de falhas (propriedade)', () => {
  it('nada se perde, nada se aplica duas vezes, a fila esvazia e o resultado é o da execução sem falhas', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArbitrary, async (scenario) => {
        ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
        const initial = Array.from({ length: scenario.visitCount }, (_, index) =>
          makeVisit({ id: `v-${index}`, marketId: `m-${index}`, date: DAY, order: index }),
        )
        const serverVisits = [...initial]
        const server = createFakeSyncGateway(serverVisits, { actor: ana, faults: scenario.faults })
        const enqueued: OfflineEvent[] = []

        let counter = 0
        const open = async () => {
          const store = await openUserStore('u-ana', {
            now: () => new Date(START).toISOString(),
            newId: () => `ev-${++counter}`,
          })
          const engine = createSyncEngine({
            store,
            gateway: server.gateway,
            deviceId: 'device-1',
            batchSize: scenario.batchSize,
            now: () => new Date(START).toISOString(),
            schedule: () => () => undefined, // a repetição é o próprio teste chamando sync()
            random: () => 0.5,
          })
          return { store, engine }
        }

        let app = await open()
        await app.store.saveSnapshot({
          visits: initial,
          markets: [],
          route: [],
          fetchedAt: new Date(START).toISOString(),
        })

        for (const [step, op] of scenario.ops.entries()) {
          if (op.kind === 'act') {
            const drafts = await draftsFor(app.store, op, step)
            if (drafts.length > 0) enqueued.push(...(await app.store.enqueue(drafts)))
          } else if (op.kind === 'sync') {
            await app.engine.sync()
          } else {
            // O app é fechado à força e aberto de novo: só o que está no banco do aparelho sobrevive.
            app.engine.stop()
            app.store.close()
            app = await open()
          }
        }

        // Depois de tudo, o aparelho continua tentando até a fila esvaziar (as falhas são finitas).
        let state = await app.engine.sync()
        for (let tries = 0; state.phase !== 'idle' && tries < 40; tries += 1) {
          state = await app.engine.sync()
        }

        // 1. A fila esvazia.
        expect(state).toEqual({ phase: 'idle' })
        const view = await app.store.read()
        expect(view.pending).toEqual([])

        // 2. Nada se perde (todo evento foi decidido) e nada se aplica duas vezes.
        for (const event of enqueued) {
          expect(server.decisions.has(event.clientEventId)).toBe(true)
          expect(server.timesApplied.get(event.clientEventId) ?? 0).toBeLessThanOrEqual(1)
        }

        // 3. O que o servidor aplicou saiu da fila; o que recusou ficou guardado para explicar.
        const refused = enqueued
          .filter((event) => server.decisions.get(event.clientEventId)?.status === 'rejected')
          .map((event) => event.clientEventId)
          .sort()
        expect(view.rejected.map((item) => item.event.clientEventId).sort()).toEqual(refused)

        // 4. O resultado é o mesmo de aplicar tudo em sequência, sem nenhuma falha no caminho.
        const model = new Map(initial.map((visit) => [visit.id, visit]))
        for (const event of [...enqueued].sort((a, b) => a.seq - b.seq)) {
          const visit = model.get(event.visitId)
          if (visit === undefined) continue
          const outcome = applyOfflineEvents({
            visit,
            events: [event],
            alreadyApplied: new Set(),
            actor: ana,
          })
          if (outcome.applied.length === 1) model.set(visit.id, outcome.visit)
        }
        expect([...serverVisits].sort(byId)).toEqual([...model.values()].sort(byId))

        // 5. A cópia do aparelho acompanha o servidor.
        expect([...(view.snapshot?.visits ?? [])].sort(byId)).toEqual([...serverVisits].sort(byId))

        app.engine.stop()
        app.store.close()
      }),
      { numRuns: 120 },
    )
  })
})
