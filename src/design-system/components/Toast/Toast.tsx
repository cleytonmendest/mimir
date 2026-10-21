import type { ReactNode } from 'react'
import { cn } from '../../utils'

export type ToastKind = 'success' | 'info' | 'error'

const KIND: Record<ToastKind, string> = {
  success: 'bg-primary text-primary-foreground',
  info: 'bg-foreground text-background',
  error: 'bg-destructive text-destructive-foreground',
}

/**
 * Aviso curto no pé da tela, que aparece onde a pessoa está olhando. O erro é "alert" (lido na
 * hora); os outros são "status". Quem usa decide quando some (e se some sozinho). O aviso não
 * bloqueia o toque no que está por baixo (no celular ele cobre o pé da tela): só o "Fechar" recebe toque.
 */
export function Toast({
  kind,
  children,
  onClose,
}: {
  kind: ToastKind
  children: ReactNode
  onClose: () => void
}) {
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cn(
        'pointer-events-none fixed left-1/2 z-20 flex w-[min(560px,calc(100vw-2rem))] -translate-x-1/2 items-start justify-between gap-3 rounded-xl p-3 font-medium shadow-lg',
        KIND[kind],
      )}
      style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom, 0px))' }}
    >
      <span>{children}</span>
      <button
        type="button"
        onClick={onClose}
        className="pointer-events-auto min-h-11 shrink-0 rounded-md px-2 underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring"
      >
        Fechar
      </button>
    </div>
  )
}
