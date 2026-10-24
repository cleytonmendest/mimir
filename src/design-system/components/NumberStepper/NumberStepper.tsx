import { Minus, Plus } from 'lucide-react'
import { IconButton } from '../IconButton/IconButton'

/** Um número com "−" e "+" (alvos de toque de 44 px), sem digitar: serve para o limite de estandes. */
export function NumberStepper({
  value,
  min,
  max,
  onChange,
  label,
  unit,
}: {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  /** O que o número é, para o leitor de tela ("Limite de estandes por dia, Mercado Central"). */
  label: string
  unit?: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex items-center gap-2">
      <IconButton
        label={`Diminuir: ${label}`}
        tooltip="Diminuir"
        disabled={value <= min}
        onClick={() => {
          onChange(value - 1)
        }}
      >
        <Minus />
      </IconButton>
      <output
        aria-live="polite"
        className="min-w-[1.4ch] text-center font-display text-2xl font-semibold tabular-nums"
      >
        {value}
      </output>
      <IconButton
        label={`Aumentar: ${label}`}
        tooltip="Aumentar"
        disabled={value >= max}
        onClick={() => {
          onChange(value + 1)
        }}
      >
        <Plus />
      </IconButton>
      {unit !== undefined && <span className="text-sm text-muted-foreground">{unit}</span>}
    </div>
  )
}
