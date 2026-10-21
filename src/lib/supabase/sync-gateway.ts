import type { OfflineEvent } from '@/domain/sync'
import { getSupabase, type AppSupabaseClient } from './client'
import { SyncFailure } from './errors'
import { parseSyncResponse, toWireEvent, type SyncResponse } from './sync-wire'

export type { EventResult, RejectionCode, SyncResponse } from './sync-wire'

/** Mais que isso num envio o servidor recusa (54000). Quem monta o lote (o motor de sincronização) respeita. */
export const MAX_SYNC_BATCH = 50

/** Sinal ruim de verdade "pendura" sem erro: depois disso o envio é dado como perdido e repetido. */
const DEFAULT_TIMEOUT_MS = 30_000

/** O que o motor de sincronização precisa do servidor, sem tipo do SDK. */
export interface SyncGateway {
  /**
   * Envia um lote de eventos (até MAX_SYNC_BATCH) deste aparelho para o usuário logado. Reenviar é
   * sempre seguro: o servidor reconhece o `clientEventId` e devolve o resultado que já tinha
   * decidido. Falhas de transporte lançam SyncFailure; recusas de evento NÃO são falha, vêm em
   * `results`.
   */
  sync(request: { deviceId: string; events: readonly OfflineEvent[] }): Promise<SyncResponse>
}

interface RpcFailure {
  message: string
  code?: string | undefined
}

/**
 * status 0: o fetch nem completou (sem sinal, DNS, corte no meio ou nosso timeout). Os demais vêm
 * do PostgREST: o código do Postgres (22023, 54000...) ou do próprio PostgREST (PGRST...).
 */
function toFailure(error: RpcFailure, status: number): SyncFailure {
  const detail = error.message
  const options = { cause: error }
  if (status === 0) {
    return new SyncFailure('NETWORK', `Sem conexão com o servidor: ${detail}`, options)
  }
  if (status === 401 || status === 403 || error.code?.startsWith('PGRST30') === true) {
    return new SyncFailure('AUTH', `A sessão não vale mais: ${detail}`, options)
  }
  // Lote acima do limite: o PostgREST devolve 500 para esse código, mas repetir não adianta.
  if (error.code === '54000') {
    return new SyncFailure('BAD_REQUEST', `O servidor recusou o envio: ${detail}`, options)
  }
  // 404/PGRST202: o servidor ainda não tem a função (implantação em andamento). 408/429: pediu espera.
  if (status >= 500 || status === 404 || status === 408 || status === 429) {
    return new SyncFailure('SERVER', `O servidor não conseguiu processar: ${detail}`, options)
  }
  return new SyncFailure('BAD_REQUEST', `O servidor recusou o envio: ${detail}`, options)
}

/** O cliente só é pedido na hora de usar: sem .env o app abre e a falha aparece como erro de config. */
export function createSyncGateway(
  getClient: () => AppSupabaseClient = getSupabase,
  options: { clientVersion?: string; timeoutMs?: number } = {},
): SyncGateway {
  const clientVersion = options.clientVersion ?? __APP_VERSION__
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return {
    async sync({ deviceId, events }) {
      if (events.length > MAX_SYNC_BATCH) {
        throw new SyncFailure(
          'BAD_REQUEST',
          `Lote com ${events.length} eventos: o máximo é ${MAX_SYNC_BATCH}`,
        )
      }

      const { data, error, status } = await getClient()
        .rpc('sync_visit_events_v1', {
          p_device_id: deviceId,
          p_client_version: clientVersion,
          p_events: events.map(toWireEvent),
        })
        .abortSignal(AbortSignal.timeout(timeoutMs))
      if (error !== null) throw toFailure(error, status)
      return parseSyncResponse(data)
    },
  }
}
