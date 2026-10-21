import { Minus, Plus } from 'lucide-react'
import { Button } from '../ui/button'

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
      <Button
        variant="outline"
        size="icon"
        aria-label={`Diminuir: ${label}`}
        disabled={value <= min}
        onClick={() => {
          onChange(value - 1)
        }}
      >
        <Minus />
      </Button>
      <output
        aria-live="polite"
        className="min-w-[1.4ch] text-center font-display text-2xl font-bold tabular-nums"
      >
        {value}
      </output>
      <Button
        variant="outline"
        size="icon"
        aria-label={`Aumentar: ${label}`}
        disabled={value >= max}
        onClick={() => {
          onChange(value + 1)
        }}
      >
        <Plus />
      </Button>
      {unit !== undefined && <span className="text-sm text-muted-foreground">{unit}</span>}
    </div>
  )
}
