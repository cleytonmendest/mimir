import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '../../utils'
import { Button } from '../ui/button'

/**
 * A confirmação de uma ação destrutiva, ali mesmo onde se clicou (sem janela por cima). O que a
 * torna segura: o título diz o que será afetado, o botão que destrói leva o verbo e a cor de perigo,
 * o foco vai para a opção segura ao abrir (e o leitor de tela lê a pergunta) e Esc cancela.
 */
export function InlineConfirm({
  label,
  title,
  description,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
  className,
  children,
}: {
  /** O nome do grupo para leitor de tela e testes ("Confirmar cancelamento"). */
  label: string
  /** A pergunta, com o nome do que será afetado: "Cancelar a reserva de seg 26/10 em Loja 07?". */
  title: string
  /** O que acontece a seguir. */
  description?: string
  /** Começa com o verbo da ação: "Sim, cancelar". */
  confirmLabel: string
  cancelLabel: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
  className?: string
  /** Um campo extra (como o motivo), entre a pergunta e os botões. */
  children?: ReactNode
}) {
  const safe = useRef<HTMLButtonElement>(null)
  const questionId = useId()

  useEffect(() => {
    safe.current?.focus()
  }, [])

  return (
    <div
      role="group"
      aria-label={label}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.stopPropagation()
        onCancel()
      }}
      className={cn('grid w-full gap-3 rounded-lg border border-input p-3', className)}
    >
      <div id={questionId} className="grid gap-1">
        <p className="font-semibold">{title}</p>
        {description !== undefined && <p>{description}</p>}
      </div>
      {children}
      <div className="flex flex-wrap gap-2">
        <Button variant="destructive" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button
          ref={safe}
          variant="outline"
          disabled={busy}
          aria-describedby={questionId}
          onClick={onCancel}
        >
          {cancelLabel}
        </Button>
      </div>
    </div>
  )
}
