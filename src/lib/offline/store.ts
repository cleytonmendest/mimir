import {
  deleteDB,
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPTransaction,
  type StoreNames,
} from 'idb'
import type { EventDraft } from '@/domain/execution'
import type { OfflineEvent } from '@/domain/sync'
import type { StandardRouteEntry, Visit, VisitStatus } from '@/domain/types'
import type { Market, UserProfile } from '@/lib/supabase/mappers'
import type { RejectionCode } from '@/lib/supabase/sync-wire'

/**
 * Tudo o que o aparelho guarda para trabalhar sem rede (IndexedDB), em dois níveis:
 *
 * - `rota-device`: o que é do aparelho, não de quem o usa (`deviceId`, a última identidade).
 * - `rota-<userId>`: um banco por usuário, para dois repositores no mesmo celular nunca misturarem
 *   fila nem cópia. Tem a cópia do servidor (`snapshot`), a fila de eventos a enviar (`outbox`) e
 *   `meta`. Sair do app NÃO apaga este banco: pendência não enviada é trabalho de campo.
 *
 * Mudar o formato = acrescentar uma migration ao fim da lista (nunca editar as antigas) e só
 * acrescentar campos e stores, nunca remover: um app antigo ainda aberto tem de conseguir ler um
 * banco que um app novo já migrou (ver `openVersioned`).
 */

export type StoreErrorCode = 'QUOTA' | 'UNAVAILABLE' | 'CONSTRAINT' | 'UNKNOWN'

/** O aparelho não conseguiu ler ou gravar. Nada foi gravado pela metade: toda escrita é uma transação. */
export class OfflineStoreError extends Error {
  readonly code: StoreErrorCode

  constructor(code: StoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'OfflineStoreError'
    this.code = code
  }
}

function nameOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'name' in error
    ? String(error.name)
    : undefined
}

const UNAVAILABLE_ERRORS = new Set([
  'InvalidStateError',
  'SecurityError',
  'UnknownError',
  'NotFoundError',
  'AbortError',
])

export function toStoreError(error: unknown): OfflineStoreError {
  if (error instanceof OfflineStoreError) return error
  const options = { cause: error }
  const name = nameOf(error)
  if (name === 'QuotaExceededError') {
    return new OfflineStoreError('QUOTA', 'Acabou o espaço de armazenamento do aparelho', options)
  }
  if (name === 'ConstraintError') {
    return new OfflineStoreError('CONSTRAINT', 'Esse registro já existe no aparelho', options)
  }
  if (name !== undefined && UNAVAILABLE_ERRORS.has(name)) {
    return new OfflineStoreError(
      'UNAVAILABLE',
      'O armazenamento do aparelho não está disponível',
      options,
    )
  }
  return new OfflineStoreError('UNKNOWN', 'Falha ao usar o armazenamento do aparelho', options)
}

// ---------------------------------------------------------------------------------------------
// Banco versionado

/** Passo `n` leva o banco da versão `n` para a `n + 1`. A lista só cresce. */
export type Migration = (
  db: IDBPDatabase<unknown>,
  transaction: IDBPTransaction<unknown, string[], 'versionchange'>,
) => void

/**
 * Abre `name` na versão que a lista de migrations descreve, rodando os passos que faltam. Se o
 * disco já está numa versão MAIS NOVA (um app novo migrou e este é um app antigo ainda aberto),
 * abre assim mesmo, na versão que está lá: como só se acrescenta, o app antigo ainda entende.
 */
export async function openVersioned<S extends DBSchema>(
  name: string,
  migrations: readonly Migration[],
): Promise<IDBPDatabase<S>> {
  if (typeof indexedDB === 'undefined') {
    throw new OfflineStoreError('UNAVAILABLE', 'Este navegador não tem armazenamento no aparelho')
  }
  let opened: IDBPDatabase<S> | undefined
  // Outra aba pediu para subir a versão: sair do caminho dela, ou a migration fica esperando.
  const blocking = () => opened?.close()

  try {
    try {
      opened = await openDB<S>(name, migrations.length, {
        blocking,
        upgrade(db, oldVersion, newVersion, transaction) {
          for (let step = oldVersion; step < (newVersion ?? migrations.length); step += 1) {
            migrations[step]?.(
              db as unknown as IDBPDatabase<unknown>,
              transaction as unknown as IDBPTransaction<unknown, string[], 'versionchange'>,
            )
          }
        },
      })
    } catch (error) {
      if (nameOf(error) !== 'VersionError') throw error
      opened = await openDB<S>(name, undefined, { blocking })
    }
    return opened
  } catch (error) {
    throw toStoreError(error)
  }
}

/** Uma transação: ou tudo o que `work` fez fica gravado, ou nada. */
async function transact<
  S extends DBSchema,
  N extends StoreNames<S>,
  M extends 'readonly' | 'readwrite',
  T,
>(
  db: IDBPDatabase<S>,
  stores: N[],
  mode: M,
  work: (tx: IDBPTransaction<S, N[], M>) => Promise<T>,
): Promise<T> {
  try {
    const tx = db.transaction(stores, mode)
    try {
      const result = await work(tx)
      await tx.done
      return result
    } catch (error) {
      try {
        tx.abort()
      } catch {
        // já encerrada (foi ela mesma que falhou)
      }
      await tx.done.catch(() => undefined)
      throw error
    }
  } catch (error) {
    throw toStoreError(error)
  }
}

// ---------------------------------------------------------------------------------------------
// O aparelho

export interface Identity {
  profile: UserProfile
  /** Quando esta identidade foi confirmada pelo servidor pela última vez. */
  savedAt: string
}

interface DeviceDb extends DBSchema {
  kv: {
    key: 'deviceId' | 'identity'
    value: string | Identity
  }
}

const DEVICE_MIGRATIONS: readonly Migration[] = [
  (db) => {
    db.createObjectStore('kv')
  },
]

export interface DeviceStore {
  /** Mesmo número enquanto o aparelho guardar os dados; nasce na primeira vez que alguém pergunta. */
  deviceId(): Promise<string>
  /** Quem usou o app por último com sessão válida: deixa o app abrir sem rede. */
  identity(): Promise<Identity | null>
  saveIdentity(identity: Identity): Promise<void>
  clearIdentity(): Promise<void>
  close(): void
}

export interface StoreDeps {
  /** Instante de agora (ISO). */
  now?: () => string
  /** Id novo para um evento. */
  newId?: () => string
}

const defaultNow = () => new Date().toISOString()
const defaultNewId = () => crypto.randomUUID()

export async function openDeviceStore(deps: StoreDeps = {}): Promise<DeviceStore> {
  const newId = deps.newId ?? defaultNewId
  const db = await openVersioned<DeviceDb>('rota-device', DEVICE_MIGRATIONS)

  return {
    deviceId: () =>
      transact(db, ['kv'], 'readwrite', async (tx) => {
        const found = await tx.objectStore('kv').get('deviceId')
        if (typeof found === 'string') return found
        const created = newId()
        await tx.objectStore('kv').put(created, 'deviceId')
        return created
      }),
    identity: () =>
      transact(db, ['kv'], 'readonly', async (tx) => {
        const found = await tx.objectStore('kv').get('identity')
        return typeof found === 'object' ? found : null
      }),
    saveIdentity: (identity) =>
      transact(db, ['kv'], 'readwrite', async (tx) => {
        await tx.objectStore('kv').put(identity, 'identity')
      }),
    clearIdentity: () =>
      transact(db, ['kv'], 'readwrite', async (tx) => {
        await tx.objectStore('kv').delete('identity')
      }),
    close: () => db.close(),
  }
}

// ---------------------------------------------------------------------------------------------
// Um usuário

/** A cópia do servidor com que a tela trabalha sem rede. */
export interface Snapshot {
  visits: Visit[]
  markets: Market[]
  route: StandardRouteEntry[]
  /** Quando foi lida do servidor (hora do aparelho). */
  fetchedAt: string
}

export interface Rejection {
  code: RejectionCode
  /** Como a visita estava no servidor quando o evento foi recusado. */
  visitStatus: VisitStatus | null
  rejectedAt: string
}

/** Um evento que o servidor recusou: fica guardado até a pessoa ver a explicação. */
export interface RejectedEvent {
  event: OfflineEvent
  rejection: Rejection
}

export interface StoreView {
  snapshot: Snapshot | null
  /** Ainda não enviados, na ordem do `seq`. */
  pending: OfflineEvent[]
  rejected: RejectedEvent[]
  /** Último envio que o servidor respondeu (hora do aparelho). */
  lastSyncAt: string | null
  /**
   * Hora do servidor menos a do aparelho, em ms, no último envio. Positivo: o relógio do aparelho
   * está atrasado. null enquanto nunca houve resposta.
   */
  clockOffsetMs: number | null
  /**
   * Sobe a cada `ack`. Quem lê o servidor e depois quer guardar a cópia confere que ninguém mexeu
   * nela no meio (ver `saveSnapshot`).
   */
  revision: number
}

export interface AckInput {
  /** O servidor aplicou (ou já tinha aplicado): saem da fila. */
  applied: readonly string[]
  /** O servidor recusou: saem da fila de envio e ficam guardados para explicar à pessoa. */
  rejected: readonly {
    clientEventId: string
    code: RejectionCode
    visitStatus: VisitStatus | null
  }[]
  /** As visitas como o servidor as tem agora. */
  visits: readonly Visit[]
  /** Hora do servidor e a do aparelho ao receber a resposta. */
  serverNow: string
  deviceNow: string
}

export interface UserStore {
  read(): Promise<StoreView>
  /**
   * Troca a cópia local pela que acabou de ser lida do servidor. A fila não é tocada. Com
   * `expectedRevision` (a de quando a leitura começou), só grava se nenhum `ack` aconteceu desde
   * então: a resposta de um envio é mais nova que a leitura e não pode ser desfeita por ela.
   * Devolve false quando não gravou por isso.
   */
  saveSnapshot(snapshot: Snapshot, expectedRevision?: number): Promise<boolean>
  /**
   * Põe na fila, numa transação só, a ação da pessoa (o primeiro) e o que ela provoca em outras
   * visitas (os demais, que ganham `causedBy`). Devolve os eventos prontos, com id e `seq`.
   */
  enqueue(drafts: readonly EventDraft[]): Promise<OfflineEvent[]>
  /** Os próximos a enviar, na ordem do `seq`. */
  pending(limit?: number): Promise<OfflineEvent[]>
  /**
   * O resultado de um envio, de uma vez: tira da fila o que o servidor decidiu, guarda os recusados e
   * atualiza a cópia com as visitas que ele devolveu. Sem isso pela metade, uma queda entre os passos
   * deixaria a tela mostrando uma visita que o servidor já mudou. Repetir não faz mal.
   */
  ack(input: AckInput): Promise<void>
  /** A pessoa já viu a explicação de um recusado. */
  dismissRejected(clientEventId: string): Promise<void>
  close(): void
}

type EventWithoutSeq = OfflineEvent extends infer E
  ? E extends unknown
    ? Omit<E, 'seq'>
    : never
  : never

interface OutboxRow {
  /** Preenchido pelo próprio banco (autoIncrement) e nunca reaproveitado, nem depois de apagar. */
  seq?: number
  event: EventWithoutSeq
  enqueuedAt: string
  state: 'pending' | 'rejected'
  rejection?: Rejection
}

interface UserDb extends DBSchema {
  snapshot: { key: 'current'; value: Snapshot }
  outbox: {
    key: number
    value: OutboxRow
    indexes: { byEventId: string; byState: string }
  }
  meta: { key: 'lastSyncAt' | 'clockOffsetMs' | 'revision'; value: string | number }
}

const USER_MIGRATIONS: readonly Migration[] = [
  (db) => {
    db.createObjectStore('snapshot')
    const outbox = db.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true })
    // Um id de evento só entra uma vez: é a defesa do aparelho contra gravar o mesmo evento duas vezes.
    outbox.createIndex('byEventId', 'event.clientEventId', { unique: true })
    outbox.createIndex('byState', 'state')
    db.createObjectStore('meta')
  },
]

const userDbName = (userId: string) => `rota-${userId}`

function toEvent(row: OutboxRow): OfflineEvent {
  if (row.seq === undefined)
    throw new OfflineStoreError('UNKNOWN', 'Evento da fila sem número de ordem')
  return { ...row.event, seq: row.seq }
}

function byAgenda(a: Visit, b: Visit): number {
  return a.date.localeCompare(b.date) || a.order - b.order
}

/** As visitas devolvidas pelo servidor entram por cima das que a cópia já tinha (pelo id). */
function mergeVisits(current: readonly Visit[], fresh: readonly Visit[]): Visit[] {
  const merged = new Map(current.map((visit) => [visit.id, visit]))
  for (const visit of fresh) merged.set(visit.id, visit)
  return [...merged.values()].sort(byAgenda)
}

export async function openUserStore(userId: string, deps: StoreDeps = {}): Promise<UserStore> {
  const now = deps.now ?? defaultNow
  const newId = deps.newId ?? defaultNewId
  const db = await openVersioned<UserDb>(userDbName(userId), USER_MIGRATIONS)

  return {
    read: () =>
      transact(db, ['snapshot', 'outbox', 'meta'], 'readonly', async (tx) => {
        const rows = await tx.objectStore('outbox').getAll()
        const lastSyncAt = await tx.objectStore('meta').get('lastSyncAt')
        const clockOffsetMs = await tx.objectStore('meta').get('clockOffsetMs')
        const revision = await tx.objectStore('meta').get('revision')
        return {
          snapshot: (await tx.objectStore('snapshot').get('current')) ?? null,
          pending: rows.filter((row) => row.state === 'pending').map(toEvent),
          rejected: rows.flatMap((row) =>
            row.state === 'rejected' && row.rejection !== undefined
              ? [{ event: toEvent(row), rejection: row.rejection }]
              : [],
          ),
          lastSyncAt: typeof lastSyncAt === 'string' ? lastSyncAt : null,
          clockOffsetMs: typeof clockOffsetMs === 'number' ? clockOffsetMs : null,
          revision: typeof revision === 'number' ? revision : 0,
        }
      }),

    saveSnapshot: (snapshot, expectedRevision) =>
      transact(db, ['snapshot', 'meta'], 'readwrite', async (tx) => {
        if (expectedRevision !== undefined) {
          const revision = await tx.objectStore('meta').get('revision')
          if ((typeof revision === 'number' ? revision : 0) !== expectedRevision) return false
        }
        await tx.objectStore('snapshot').put(snapshot, 'current')
        return true
      }),

    enqueue: (drafts) =>
      transact(db, ['outbox'], 'readwrite', async (tx) => {
        const enqueuedAt = now()
        const events: OfflineEvent[] = []
        let cause: string | undefined
        for (const draft of drafts) {
          const clientEventId = newId()
          const event = {
            ...draft,
            clientEventId,
            ...(cause === undefined ? {} : { causedBy: cause }),
          }
          const seq = await tx.objectStore('outbox').add({ event, enqueuedAt, state: 'pending' })
          events.push({ ...event, seq })
          cause ??= clientEventId
        }
        return events
      }),

    pending: (limit = Number.POSITIVE_INFINITY) =>
      transact(db, ['outbox'], 'readonly', async (tx) => {
        const rows = await tx.objectStore('outbox').index('byState').getAll('pending')
        return rows
          .map(toEvent)
          .sort((a, b) => a.seq - b.seq)
          .slice(0, limit)
      }),

    ack: (input) =>
      transact(db, ['snapshot', 'outbox', 'meta'], 'readwrite', async (tx) => {
        const outbox = tx.objectStore('outbox')
        const byEventId = outbox.index('byEventId')

        // Só conta como mudança o que de fato mudou: repetir um ack não mexe na revisão.
        let changed = false
        for (const clientEventId of input.applied) {
          const row = await byEventId.get(clientEventId)
          if (row?.seq !== undefined && row.state === 'pending') {
            await outbox.delete(row.seq)
            changed = true
          }
        }
        for (const refused of input.rejected) {
          const row = await byEventId.get(refused.clientEventId)
          if (row === undefined || row.state !== 'pending') continue
          await outbox.put({
            ...row,
            state: 'rejected',
            rejection: {
              code: refused.code,
              visitStatus: refused.visitStatus,
              rejectedAt: input.deviceNow,
            },
          })
          changed = true
        }

        // Sem cópia ainda (nunca carregou), não há onde pôr as visitas: a tela busca ao abrir.
        const snapshots = tx.objectStore('snapshot')
        const snapshot = await snapshots.get('current')
        if (snapshot !== undefined && input.visits.length > 0) {
          await snapshots.put(
            { ...snapshot, visits: mergeVisits(snapshot.visits, input.visits) },
            'current',
          )
          changed = true
        }

        const meta = tx.objectStore('meta')
        if (changed) {
          const revision = await meta.get('revision')
          await meta.put((typeof revision === 'number' ? revision : 0) + 1, 'revision')
        }
        await meta.put(input.deviceNow, 'lastSyncAt')
        await meta.put(Date.parse(input.serverNow) - Date.parse(input.deviceNow), 'clockOffsetMs')
      }),

    dismissRejected: (clientEventId) =>
      transact(db, ['outbox'], 'readwrite', async (tx) => {
        const outbox = tx.objectStore('outbox')
        const row = await outbox.index('byEventId').get(clientEventId)
        if (row?.seq !== undefined && row.state === 'rejected') await outbox.delete(row.seq)
      }),

    close: () => db.close(),
  }
}

/** Apaga o banco de um usuário (só quando não há nada a enviar). */
export async function deleteUserStore(userId: string): Promise<void> {
  try {
    await deleteDB(userDbName(userId))
  } catch (error) {
    throw toStoreError(error)
  }
}
