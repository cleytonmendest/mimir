import type { SyncState } from '@/lib/offline/sync-engine'
import { formatTime } from './format'

export interface DiagnosticsInput {
  version: string
  deviceId: string
  unsent: number
  sync: SyncState
  lastSyncAt: string | null
  fetchedAt: string | null
  clockOffsetMs: number | null
}

function describeSync(sync: SyncState): string {
  switch (sync.phase) {
    case 'waiting':
      return `esperando (${sync.reason}, tentativa ${sync.attempt}, de novo às ${formatTime(sync.retryAt)})`
    case 'blocked':
      return `parado (${sync.reason}): ${sync.error.message}`
    case 'upgrade_required':
      return `app velho demais (mínimo ${sync.minClientVersion})`
    case 'auth_required':
      return 'sessão vencida'
    case 'syncing':
      return 'enviando'
    case 'idle':
      return 'em dia'
  }
}

/** O que o suporte pergunta, em texto puro para copiar e colar. */
export function buildDiagnostics(input: DiagnosticsInput): string {
  const offset =
    input.clockOffsetMs === null
      ? 'nunca medido'
      : `${Math.round(input.clockOffsetMs / 1000)} s (positivo = relógio do aparelho atrasado)`
  return [
    `Versão do app: ${input.version}`,
    `Aparelho: ${input.deviceId}`,
    `Registros por enviar: ${input.unsent}`,
    `Envio: ${describeSync(input.sync)}`,
    `Último envio: ${input.lastSyncAt ?? 'nunca'}`,
    `Lista lida do servidor em: ${input.fetchedAt ?? 'nunca'}`,
    `Relógio do aparelho: ${offset}`,
  ].join('\n')
}
