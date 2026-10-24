import type { ReactNode } from 'react'
import { cn } from '../../utils'

/**
 * Um mercado para escolher, numa linha compacta: com dezenas de mercados a lista precisa caber
 * na tela. O nome é o botão (aria-pressed); o selo (`badge`, canto direito) é só para olhar e deixa
 * passar o toque, e o rodapé (`children`) fica fora do botão, para poder ter controles próprios.
 */
export function MarketCard({
  name,
  subtitle,
  badge,
  selected,
  onSelect,
  children,
}: {
  name: string
  subtitle?: string
  /** Um dado curto, como o limite de estandes. */
  badge?: ReactNode
  selected: boolean
  onSelect: () => void
  children?: ReactNode
}) {
  return (
    <div
      className={cn(
        'relative rounded-lg border bg-card text-card-foreground',
        selected ? 'border-primary ring-1 ring-primary' : 'border-border',
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cn(
          'block min-h-11 w-full rounded-lg py-2 pl-4 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring',
          badge === undefined ? 'pr-4' : 'pr-24',
        )}
      >
        <span className="block font-display text-lg leading-tight font-semibold">{name}</span>
        {subtitle !== undefined && (
          <span className="block text-sm leading-snug text-muted-foreground">{subtitle}</span>
        )}
      </button>
      {badge !== undefined && (
        <span className="pointer-events-none absolute top-2 right-4 text-right text-xs leading-tight text-muted-foreground">
          {badge}
        </span>
      )}
      {children !== undefined && children !== null && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pb-3 text-sm text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  )
}
