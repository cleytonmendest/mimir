import { useState, type ReactNode } from 'react'
import { Button } from '@/design-system/components/ui/button'
import { Textarea } from '@/design-system/components/ui/textarea'
import { copyText } from '@/features/access/share'
import { buildErrorReport } from './error-report'

/**
 * Uma falha que a pessoa não resolve sozinha (sem conexão, servidor fora): diz o que houve em
 * português, deixa tentar de novo e, num clique, copia os detalhes técnicos (quando, onde, versão
 * e o erro) para ela mandar a quem dá suporte, em vez de descrever de memória.
 */
export function FailureNotice({
  message,
  details,
  onRetry,
  retryLabel = 'Tentar de novo',
  className = 'grid gap-3',
  children,
}: {
  message: string
  /** O lado técnico do erro; null quando não há exceção (o servidor só recusou). */
  details: string | null
  onRetry: () => void
  retryLabel?: string
  className?: string
  /** Outras saídas, ao lado das duas de sempre (por exemplo, "Sair"). */
  children?: ReactNode
}) {
  const [feedback, setFeedback] = useState<string | null>(null)
  // Sem permissão para copiar, o texto fica à vista para selecionar à mão.
  const [manual, setManual] = useState<string | null>(null)

  async function copy() {
    const report = buildErrorReport({
      message,
      details,
      at: new Date(),
      path: window.location.pathname,
      version: __APP_VERSION__,
    })
    if (await copyText(report)) {
      setFeedback('Detalhes copiados.')
      setManual(null)
    } else {
      setFeedback('Não deu para copiar. Selecione o texto abaixo e copie.')
      setManual(report)
    }
  }

  return (
    <div className={className}>
      <p role="alert" className="text-destructive">
        {message}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onRetry}>{retryLabel}</Button>
        <Button
          variant="outline"
          onClick={() => {
            void copy()
          }}
        >
          Copiar detalhes do erro
        </Button>
        {children}
      </div>
      {feedback !== null && (
        <p role="status" className="text-sm font-semibold">
          {feedback}
        </p>
      )}
      {manual !== null && (
        <Textarea
          readOnly
          aria-label="Detalhes do erro"
          value={manual}
          rows={6}
          onFocus={(event) => {
            event.currentTarget.select()
          }}
        />
      )}
    </div>
  )
}
