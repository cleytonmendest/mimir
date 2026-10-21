import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { keyOf } from '@/domain/keys'
import { ana, idGenerator } from '@/domain/testing'
import type { StandardRouteEntry, Visit } from '@/domain/types'
import { openUserStore, type UserStore } from '@/lib/offline/store'
import { createSyncEngine, type SyncEngine } from '@/lib/offline/sync-engine'
import { createFakeSyncGateway, type Fault } from '@/lib/offline/testing'
import { DataError } from '@/lib/supabase/errors'
import type { Market } from '@/lib/supabase/mappers'
import type { VisitChange, VisitsGateway } from '@/lib/supabase/visits-gateway'
import type { Clock, Moment } from './clock'

/** Apoio só para testes. Não importar em código de produção. */

export interface FakeServer {
  visits: Visit[]
  route: StandardRouteEntry[]
  markets: Market[]
}

export function market(id: string, name: string, address: string | null = null): Market {
  return { id, name, address, archived: false }
}

/**
 * Servidor em memória com o mesmo comportamento que importa do banco de verdade: não duplica a
 * visita de um (repositor, mercado, dia) e só grava uma mudança se a visita ainda estiver no status
 * em que a tela a viu (senão, CONFLICT). Devolve cópias, como a rede: mexer no `server` num teste
 * ("o líder cancelou") não altera o que a tela já carregou.
 */
export function createFakeVisitsGateway(
  seed: Partial<FakeServer> = {},
  options: { isOnline?: () => boolean } = {},
) {
  const server: FakeServer = {
    visits: [...(seed.visits ?? [])],
    route: [...(seed.route ?? [])],
    markets: [...(seed.markets ?? [])],
  }
  /** Cada chamada de gravação, com os ids na ordem recebida. */
  const saved: string[][] = []
  const failures = new Map<keyof VisitsGateway, Error>()

  /** Como a rede: a falha chega como promessa rejeitada, não como exceção na hora da chamada. */
  function takeFailure(method: keyof VisitsGateway): Promise<never> | undefined {
    if (options.isOnline?.() === false) return Promise.reject(new Error('sem rede'))
    const failure = failures.get(method)
    if (failure === undefined) return undefined
    failures.delete(method)
    return Promise.reject(failure)
  }

  const gateway: VisitsGateway = {
    listVisits(range) {
      const failure = takeFailure('listVisits')
      if (failure !== undefined) return failure
      return Promise.resolve(
        server.visits
          .filter(
            (visit) =>
              visit.date >= range.from &&
              visit.date <= range.to &&
              (range.repositorId === undefined || visit.repositorId === range.repositorId),
          )
          .sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order)
          .map((visit) => ({ ...visit })),
      )
    },
    listStandardRoute(repositorId) {
      const failure = takeFailure('listStandardRoute')
      if (failure !== undefined) return failure
      return Promise.resolve(
        server.route
          .filter((entry) => repositorId === undefined || entry.repositorId === repositorId)
          .map((entry) => ({ ...entry })),
      )
    },
    listMarkets() {
      const failure = takeFailure('listMarkets')
      if (failure !== undefined) return failure
      return Promise.resolve(server.markets.map((item) => ({ ...item })))
    },
    createVisits(visits) {
      const failure = takeFailure('createVisits')
      if (failure !== undefined) return failure
      for (const visit of visits) {
        if (!server.visits.some((existing) => keyOf(existing) === keyOf(visit))) {
          server.visits.push({ ...visit })
        }
      }
      return Promise.resolve()
    },
    saveChanges(changes: readonly VisitChange[]) {
      const failure = takeFailure('saveChanges')
      if (failure !== undefined) return failure
      saved.push(changes.map((change) => change.after.id))
      for (const { before, after } of changes) {
        const index = server.visits.findIndex((visit) => visit.id === after.id)
        const current = server.visits[index]
        if (current === undefined || current.status !== before.status) {
          return Promise.reject(new DataError('CONFLICT', 'A visita mudou no servidor'))
        }
        server.visits[index] = { ...after }
      }
      return Promise.resolve()
    },
  }

  return {
    gateway,
    server,
    saved,
    /** A próxima chamada deste método falha com o erro dado (uma vez só). */
    failNext: (method: keyof VisitsGateway, error: Error) => {
      failures.set(method, error)
    },
    /** O que o servidor guarda hoje da visita. */
    visit: (id: string): Visit => {
      const found = server.visits.find((visit) => visit.id === id)
      if (found === undefined) throw new Error(`visita ${id} não existe no servidor falso`)
      return found
    },
  }
}

// 2026-10-21 é quarta-feira (weekday 3).
export const TODAY = '2026-10-21'
export const NOW = '2026-10-21T14:00:00.000Z'

/**
 * O aparelho e o servidor de mentira juntos: a tela de verdade, a fila no IndexedDB de teste, o
 * motor de envio de verdade e um servidor em memória que lê (VisitsGateway) e recebe eventos
 * (SyncGateway) sobre as mesmas visitas. `net.online = false` corta a rede dos dois.
 */
export async function createDevice(
  seed: Partial<FakeServer> = {},
  options: { faults?: readonly Fault[] } = {},
) {
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
  const net = { online: true }
  const moment: Moment = { now: NOW, today: TODAY }
  const fake = createFakeVisitsGateway(seed, { isOnline: () => net.online })
  const server = createFakeSyncGateway(fake.server.visits, {
    actor: ana,
    isOnline: () => net.online,
    ...(options.faults === undefined ? {} : { faults: options.faults }),
  })

  const opened: { store: UserStore; engine: SyncEngine }[] = []
  /** Abre o app: um banco local e um motor de envio novos sobre o MESMO IndexedDB (como reabrir o app). */
  async function open() {
    const store = await openUserStore(ana.id, { now: () => moment.now, newId: idGenerator('ev') })
    const engine = createSyncEngine({
      store,
      gateway: server.gateway,
      deviceId: 'device-1',
      now: () => moment.now,
      schedule: () => () => undefined, // quem repete é o teste, chamando syncNow()
    })
    opened.push({ store, engine })
    return { store, engine }
  }
  const session = await open()

  const clock: Clock = () => ({ ...moment })
  return {
    net,
    moment,
    clock,
    fake,
    server,
    session,
    open,
    close: () => {
      for (const item of opened) {
        item.engine.stop()
        item.store.close()
      }
    },
  }
}
