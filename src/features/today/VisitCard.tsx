import { useId, useState, type FormEvent } from 'react'
import { StatusBadge } from '@/design-system/components/StatusBadge/StatusBadge'
import { Button } from '@/design-system/components/ui/button'
import { Label } from '@/design-system/components/ui/label'
import { Textarea } from '@/design-system/components/ui/textarea'
import type { Visit } from '@/domain/types'
import type { Market } from '@/lib/supabase/mappers'
import { formatTime } from './format'

type Mode = 'idle' | 'checkOut' | 'notDone'

export interface VisitCardProps {
  visit: Visit
  market: Market | undefined
  /** Esta visita está sendo gravada agora. */
  busy: boolean
  /** Alguma visita está sendo gravada: as ações de todas esperam. */
  locked: boolean
  /** Há algo registrado nesta visita que ainda não chegou ao servidor. */
  unsent?: boolean
  onCheckIn: () => void
  onCheckOut: (note: string) => void
  onNotDone: (reason: string) => void
}

/**
 * Uma visita do dia com o que o repositor pode fazer nela. Observação e motivo abrem aqui mesmo
 * no cartão (sem janela por cima): o app é usado em pé, com uma mão, e cada tela a mais pesa.
 */
export function VisitCard({
  visit,
  market,
  busy,
  locked,
  unsent = false,
  onCheckIn,
  onCheckOut,
  onNotDone,
}: VisitCardProps) {
  const [mode, setMode] = useState<Mode>('idle')
  const [text, setText] = useState('')
  const [reasonMissing, setReasonMissing] = useState(false)
  const fieldId = useId()

  const name = market?.name ?? 'Mercado'
  const isOpen = visit.status === 'planned' || visit.status === 'in_progress'

  function openForm(next: Mode) {
    setMode(next)
    setText('')
    setReasonMissing(false)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mode === 'notDone') {
      if (text.trim() === '') {
        setReasonMissing(true)
        return
      }
      onNotDone(text)
    } else {
      onCheckOut(text)
    }
  }

  const times =
    visit.checkInAt === null
      ? null
      : `Entrada ${formatTime(visit.checkInAt)}${
          visit.checkOutAt === null ? '' : ` · Saída ${formatTime(visit.checkOutAt)}`
        }`

  return (
    <li className="rounded-lg border border-border bg-card p-4 text-card-foreground">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-medium">{name}</h3>
          {market?.address ? <p className="text-muted-foreground">{market.address}</p> : null}
        </div>
        <StatusBadge status={visit.status} />
      </div>

      {times === null ? null : <p className="mt-2 text-muted-foreground">{times}</p>}
      {unsent && (
        <p className="mt-2 text-sm text-muted-foreground">
          Registrado neste aparelho. Ainda não foi enviado.
        </p>
      )}
      {visit.note === null ? null : <p className="mt-2">Observação: {visit.note}</p>}
      {visit.skipReason === null ? null : <p className="mt-2">Motivo: {visit.skipReason}</p>}

      {isOpen && mode === 'idle' && (
        <div className="mt-4 flex flex-wrap gap-2">
          {visit.status === 'planned' ? (
            <Button aria-label={`Fazer check-in em ${name}`} disabled={locked} onClick={onCheckIn}>
              {busy ? 'Salvando…' : 'Fazer check-in'}
            </Button>
          ) : (
            <Button
              aria-label={`Fazer check-out em ${name}`}
              disabled={locked}
              onClick={() => {
                openForm('checkOut')
              }}
            >
              Fazer check-out
            </Button>
          )}
          <Button
            variant="outline"
            aria-label={`Não fui em ${name}`}
            disabled={locked}
            onClick={() => {
              openForm('notDone')
            }}
          >
            Não fui
          </Button>
        </div>
      )}

      {isOpen && mode !== 'idle' && (
        <form onSubmit={submit} className="mt-4 grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor={fieldId}>
              {mode === 'checkOut' ? 'Observação (opcional)' : 'Por que não foi?'}
            </Label>
            <Textarea
              id={fieldId}
              value={text}
              aria-invalid={reasonMissing}
              aria-describedby={reasonMissing ? `${fieldId}-error` : undefined}
              onChange={(event) => {
                setText(event.target.value)
              }}
            />
            {reasonMissing && (
              <p id={`${fieldId}-error`} role="alert" className="text-destructive">
                Informe o motivo de não ter ido.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={locked}>
              {busy ? 'Salvando…' : mode === 'checkOut' ? 'Concluir visita' : 'Confirmar'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={() => {
                openForm('idle')
              }}
            >
              Voltar
            </Button>
          </div>
        </form>
      )}
    </li>
  )
}
