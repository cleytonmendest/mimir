import { Button } from '@/design-system/components/ui/button'

export type SyncTone = 'ok' | 'working' | 'waiting' | 'problem'

/** Mesma paleta dos selos de status: verde = em dia, azul = trabalhando, âmbar = espera, vermelho = precisa de ação. */
const TONE_STYLES: Record<SyncTone, string> = {
  ok: 'bg-status-done text-status-done-fg',
  working: 'bg-status-planned text-status-planned-fg',
  waiting: 'bg-status-in-progress text-status-in-progress-fg',
  problem: 'bg-status-not-done text-status-not-done-fg',
}

export interface SyncStatusProps {
  tone: SyncTone
  /** O que está acontecendo, em uma linha. */
  title: string
  /** Quando e por quê, se ajudar. */
  detail?: string | undefined
  action?: { label: string; onClick: () => void } | undefined
}

/**
 * Onde está o trabalho do repositor: enviado, a caminho, esperando sinal ou parado por um problema.
 * É a primeira coisa que ele olha ao sair do mercado, então fala em português claro, nunca em código.
 * `role="status"` avisa a leitor de tela a cada mudança, sem interromper.
 */
export function SyncStatus({ tone, title, detail, action }: SyncStatusProps) {
  return (
    <div
      role="status"
      className={`mt-4 flex items-center justify-between gap-3 rounded-lg px-4 py-3 ${TONE_STYLES[tone]}`}
    >
      <div>
        <p className="font-medium">{title}</p>
        {detail !== undefined && <p className="text-sm">{detail}</p>}
      </div>
      {action !== undefined && (
        <Button variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </div>
  )
}
