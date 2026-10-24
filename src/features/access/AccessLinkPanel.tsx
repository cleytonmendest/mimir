import { useState } from 'react'
import { Button } from '@/design-system/components/ui/button'
import { Input } from '@/design-system/components/ui/input'
import { Label } from '@/design-system/components/ui/label'
import { canShare, copyText, shareText, whatsAppLink } from './share'

/**
 * Um link para o administrador entregar a alguém: copiar, mandar pelo WhatsApp ou abrir a folha
 * de compartilhar do celular. O sistema não manda e-mail nenhum: quem entrega é o administrador.
 */
export function AccessLinkPanel({
  title,
  hint,
  url,
  message,
  copyLabel = 'Copiar link',
  shareTitle,
}: {
  title: string
  hint: string
  url: string
  /** O texto que vai junto no WhatsApp e no compartilhar. */
  message: string
  copyLabel?: string
  shareTitle: string
}) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const inputId = `link-${title.replace(/\W+/g, '-').toLowerCase()}`

  async function copy() {
    setFeedback(
      (await copyText(url)) ? 'Link copiado.' : 'Não deu para copiar. Selecione o link e copie.',
    )
  }

  return (
    <section
      aria-label={title}
      className="grid gap-3 rounded-xl border border-border bg-muted/40 p-4"
    >
      <h3 className="font-display text-xl leading-tight font-semibold">{title}</h3>
      <p className="text-muted-foreground">{hint}</p>
      <div className="grid gap-2">
        <Label htmlFor={inputId}>Link</Label>
        <Input
          id={inputId}
          readOnly
          value={url}
          onFocus={(event) => {
            event.currentTarget.select()
          }}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          onClick={() => {
            void copy()
          }}
        >
          {copyLabel}
        </Button>
        <Button variant="outline" asChild>
          <a href={whatsAppLink(message)} target="_blank" rel="noopener noreferrer">
            Enviar pelo WhatsApp
          </a>
        </Button>
        {canShare() && (
          <Button
            variant="outline"
            onClick={() => {
              void shareText(shareTitle, message)
            }}
          >
            Compartilhar
          </Button>
        )}
      </div>
      {feedback !== null && (
        <p role="status" className="text-sm font-semibold">
          {feedback}
        </p>
      )}
    </section>
  )
}
