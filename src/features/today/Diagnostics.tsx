import { useState } from 'react'
import { Button } from '@/design-system/components/ui/button'
import { buildDiagnostics, type DiagnosticsInput } from './diagnostics-text'

/** Detalhes técnicos do envio, fechados por padrão: para o suporte, não para o dia a dia. */
export function Diagnostics(props: DiagnosticsInput) {
  const [copied, setCopied] = useState(false)
  const text = buildDiagnostics(props)

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      // sem permissão de área de transferência: o texto abaixo continua selecionável
    }
  }

  return (
    <details className="mt-6 text-sm text-muted-foreground">
      <summary className="min-h-11 cursor-pointer py-2">Detalhes do envio</summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg bg-muted p-3 text-foreground">
        {text}
      </pre>
      <div className="mt-2 flex items-center gap-3">
        <Button variant="outline" onClick={() => void copy()}>
          Copiar
        </Button>
        {copied && <span role="status">Copiado.</span>}
      </div>
    </details>
  )
}
