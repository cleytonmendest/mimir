import { cn } from '../../utils'

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

/** Uma escolha entre poucas opções lado a lado (abas do administrador, modo do cadastro). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  /** O que se está escolhendo, para o leitor de tela. */
  label: string
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex max-w-full flex-wrap overflow-hidden rounded-lg border border-input bg-card"
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => {
            onChange(option.value)
          }}
          className={cn(
            'min-h-11 px-4 font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset',
            index > 0 && 'border-l border-input',
            option.value === value
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-card-foreground hover:bg-muted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
