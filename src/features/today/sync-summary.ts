import type { SyncTone } from '@/design-system/components/SyncStatus/SyncStatus'
import type { SyncState } from '@/lib/offline/sync-engine'
import { formatTime } from './format'

export interface SyncSummary {
  tone: SyncTone
  title: string
  detail?: string
  /** O botão que faz sentido agora, se algum. */
  action?: 'syncNow'
}

function records(count: number): string {
  return count === 1 ? '1 registro' : `${count} registros`
}

/**
 * O que dizer à pessoa sobre o envio. Sempre afirma o que ela mais precisa saber: o trabalho dela
 * está guardado (ou já foi) e o que falta fazer, se algo.
 */
export function summarizeSync(input: {
  state: SyncState
  unsent: number
  lastSyncAt: string | null
}): SyncSummary {
  const { state, unsent, lastSyncAt } = input
  const waitingToSend = unsent > 0 ? records(unsent) + ' para enviar' : null
  const safe =
    unsent === 0
      ? undefined
      : unsent === 1
        ? 'Seu registro está guardado neste aparelho.'
        : `Seus ${unsent} registros estão guardados neste aparelho.`

  switch (state.phase) {
    case 'syncing':
      return { tone: 'working', title: 'Enviando…' }
    case 'waiting':
      return {
        tone: 'waiting',
        title: waitingToSend ?? 'Sem conexão com o servidor',
        detail: `Sem conexão. Tentando de novo às ${formatTime(state.retryAt)}.`,
        action: 'syncNow',
      }
    case 'auth_required':
      return {
        tone: 'problem',
        title: 'Entre de novo para enviar',
        ...(safe === undefined ? {} : { detail: safe }),
      }
    case 'upgrade_required':
      return {
        tone: 'problem',
        title: 'Atualize o app para enviar',
        detail: `${safe ?? 'Nada se perde.'} Tudo será enviado depois da atualização.`,
      }
    case 'blocked':
      return {
        tone: 'problem',
        title: 'Não foi possível enviar',
        detail: `${safe ?? ''} Informe os detalhes abaixo ao suporte.`.trim(),
        action: 'syncNow',
      }
    case 'idle':
      if (unsent > 0) return { tone: 'waiting', title: waitingToSend ?? '', action: 'syncNow' }
      return {
        tone: 'ok',
        title: 'Tudo enviado',
        ...(lastSyncAt === null ? {} : { detail: `Último envio às ${formatTime(lastSyncAt)}.` }),
      }
  }
}
