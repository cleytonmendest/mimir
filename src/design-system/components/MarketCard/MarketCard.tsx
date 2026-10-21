import type { ReactNode } from 'react'
import { cn } from '../../utils'

/**
 * Um mercado para escolher. O nome é o botão (aria-pressed); o rodapé (`children`) fica de fora
 * dele, para poder ter controles próprios, como o limite de estandes.
 */
export function MarketCard({
  name,
  subtitle,
  selected,
  onSelect,
  children,
}: {
  name: string
  subtitle?: string
  selected: boolean
  onSelect: () => void
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-lg border bg-card text-card-foreground',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="block min-h-11 w-full rounded-lg px-3.5 pt-3 pb-1 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
      >
        <span className="block font-display text-xl leading-tight font-semibold">{name}</span>
        {subtitle !== undefined && (
          <span className="block text-sm text-muted-foreground">{subtitle}</span>
        )}
      </button>
      {children !== undefined && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3.5 pb-3 text-sm text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  )
}
