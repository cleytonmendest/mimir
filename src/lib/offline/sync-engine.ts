import { SyncFailure } from '@/lib/supabase/errors'
import { MAX_SYNC_BATCH, type SyncGateway } from '@/lib/supabase/sync-gateway'
import type { UserStore } from './store'

/**
 * Leva a fila do aparelho até o servidor. Não decide nada sobre visitas: só envia em lotes, na ordem,
 * e entrega o resultado ao `store.ack`, que o aplica de uma vez. Como o servidor é idempotente
 * (reenviar um evento já decidido devolve a mesma resposta), qualquer falha no meio é resolvida do
 * mesmo jeito: tentar de novo. Nada se perde e nada se aplica duas vezes.
 */

export type SyncState =
  | { phase: 'idle' }
  | { phase: 'syncing' }
  /** Sem sinal ou servidor com problema: tenta sozinho de novo em `retryAt`, com espera crescente. */
  | { phase: 'waiting'; reason: 'NETWORK' | 'SERVER'; retryAt: string; attempt: number }
  /** A sessão não vale mais: só volta a tentar quando o app avisar (`resume`). */
  | { phase: 'auth_required' }
  /** O app é velho demais: a fila continua guardada até ele ser atualizado. */
  | { phase: 'upgrade_required'; minClientVersion: string }
  /** Repetir não resolve (defeito do app, resposta que ele não entende, armazenamento com problema). */
  | { phase: 'blocked'; reason: 'BAD_REQUEST' | 'INVALID_RESPONSE' | 'UNEXPECTED'; error: Error }

export interface SyncEngine {
  state(): SyncState
  /** Avisa a cada mudança de estado. Devolve a função que cancela o aviso. */
  subscribe(listener: (state: SyncState) => void): () => void
  /**
   * Envia o que está na fila agora. Pedidos que chegam durante um envio viram uma rodada a mais no
   * fim dele (para pegar o que foi gravado enquanto isso). Nunca rejeita: o resultado é o estado.
   * Também serve de "tentar agora" quando o motor está esperando para repetir.
   */
  sync(): Promise<SyncState>
  /** A sessão voltou (ou o app foi atualizado): tira o motor de `auth_required` e tenta já. */
  resume(): Promise<SyncState>
  /** Cancela a espera pendente (ao sair do app ou trocar de usuário). */
  stop(): void
}

export interface SyncEngineDeps {
  store: UserStore
  gateway: SyncGateway
  deviceId: string
  /** Eventos por envio. Nunca acima do limite do servidor. */
  batchSize?: number
  now?: () => string
  /** Agenda `callback` daqui a `ms`; devolve o cancelamento. */
  schedule?: (callback: () => void, ms: number) => () => void
  random?: () => number
}

const BASE_DELAY_MS = 2_000
const MAX_DELAY_MS = 5 * 60_000

/** 2 s, 4 s, 8 s... até 5 min, com variação de ±20% para vários aparelhos não baterem juntos. */
export function retryDelayMs(attempt: number, random: () => number): number {
  const base = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1))
  return Math.round(base * (0.8 + 0.4 * random()))
}

const defaultSchedule = (callback: () => void, ms: number) => {
  const handle = setTimeout(callback, ms)
  return () => clearTimeout(handle)
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function createSyncEngine(deps: SyncEngineDeps): SyncEngine {
  const { store, gateway, deviceId } = deps
  const batchSize = Math.min(deps.batchSize ?? MAX_SYNC_BATCH, MAX_SYNC_BATCH)
  const now = deps.now ?? (() => new Date().toISOString())
  const schedule = deps.schedule ?? defaultSchedule
  const random = deps.random ?? Math.random

  let current: SyncState = { phase: 'idle' }
  const listeners = new Set<(state: SyncState) => void>()
  let running: Promise<SyncState> | null = null
  let again = false
  let attempt = 0
  let cancelWait: (() => void) | null = null

  function setState(next: SyncState): void {
    current = next
    for (const listener of [...listeners]) listener(next)
  }

  function clearWait(): void {
    cancelWait?.()
    cancelWait = null
  }

  function wait(reason: 'NETWORK' | 'SERVER'): void {
    attempt += 1
    const delay = retryDelayMs(attempt, random)
    setState({
      phase: 'waiting',
      reason,
      retryAt: new Date(Date.parse(now()) + delay).toISOString(),
      attempt,
    })
    cancelWait = schedule(() => {
      cancelWait = null
      void sync()
    }, delay)
  }

  /** Uma rodada: envia lote após lote até a fila esvaziar ou algo impedir. */
  async function drain(): Promise<SyncState> {
    for (;;) {
      const batch = await store.pending(batchSize)
      if (batch.length === 0) {
        attempt = 0
        setState({ phase: 'idle' })
        return current
      }

      setState({ phase: 'syncing' })
      const response = await gateway.sync({ deviceId, events: batch })
      if (response.kind === 'upgrade_required') {
        setState({ phase: 'upgrade_required', minClientVersion: response.minClientVersion })
        return current
      }

      const sent = new Set(batch.map((event) => event.clientEventId))
      const decided = response.results.filter((result) => sent.has(result.clientEventId))
      if (decided.length === 0) {
        // Responder sem decidir nenhum evento do lote faria o mesmo lote voltar para sempre.
        throw new SyncFailure('INVALID_RESPONSE', 'O servidor não decidiu nenhum evento do lote')
      }
      await store.ack({
        applied: decided
          .filter((result) => result.status === 'applied')
          .map((result) => result.clientEventId),
        rejected: decided
          .filter((result) => result.status === 'rejected')
          .map((result) => ({
            clientEventId: result.clientEventId,
            code: result.code ?? 'UNRECOGNIZED',
            visitStatus: result.visitStatus,
          })),
        visits: response.visits,
        serverNow: response.serverNow,
        deviceNow: now(),
      })
      attempt = 0
    }
  }

  async function round(): Promise<SyncState> {
    try {
      return await drain()
    } catch (raw) {
      const error = asError(raw)
      if (error instanceof SyncFailure) {
        switch (error.code) {
          case 'NETWORK':
          case 'SERVER':
            wait(error.code)
            return current
          case 'AUTH':
            setState({ phase: 'auth_required' })
            return current
          case 'BAD_REQUEST':
          case 'INVALID_RESPONSE':
            setState({ phase: 'blocked', reason: error.code, error })
            return current
        }
      }
      setState({ phase: 'blocked', reason: 'UNEXPECTED', error })
      return current
    }
  }

  function sync(): Promise<SyncState> {
    if (running !== null) {
      again = true
      return running
    }
    clearWait()
    running = (async () => {
      try {
        let result = await round()
        while (again && (result.phase === 'idle' || result.phase === 'waiting')) {
          again = false
          clearWait()
          result = await round()
        }
        return result
      } finally {
        again = false
        running = null
      }
    })()
    return running
  }

  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    sync,
    resume() {
      if (current.phase === 'auth_required') attempt = 0
      return sync()
    },
    stop() {
      clearWait()
      listeners.clear()
    },
  }
}
