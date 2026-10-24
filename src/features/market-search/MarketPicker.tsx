import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { MarketCard } from '@/design-system/components/MarketCard/MarketCard'
import { Button } from '@/design-system/components/ui/button'
import { cn } from '@/design-system/utils'
import { plural } from '@/domain/format'
import { groupByNeighborhood, shouldGroup, type Searchable } from '@/domain/market-search'
import { MarketSearchField } from './MarketSearchField'
import { useMarketSearch } from './useMarketSearch'
import { useWideScreen } from './useWideScreen'

export interface PickableMarket extends Searchable {
  id: string
  capacity: number
}

/**
 * A lista de mercados para escolher, a mesma para o fornecedor e para o administrador. Com dezenas
 * de lojas ela não pode esticar a página:
 * - a lista tem altura limitada e rola por dentro (no computador, a caixa fica à vista enquanto o
 *   resto da página rola);
 * - no celular, ao escolher um mercado a lista se recolhe e sobra só ele, com "Trocar de mercado":
 *   o calendário aparece logo abaixo, sem rolar por 30 lojas até encontrá-lo;
 * - com muitos mercados em mais de um bairro, a lista ganha um título por bairro (que fica preso no
 *   topo enquanto se rola): achar a loja de um bairro vira ler títulos, não 30 cartões.
 */
export function MarketPicker<T extends PickableMarket>({
  headingId,
  hint,
  emptyMessage,
  markets,
  selectedId,
  onSelect,
  detail,
}: {
  headingId: string
  /** O que fazer com a lista, em uma frase. */
  hint: string
  emptyMessage: string
  markets: readonly T[]
  selectedId: string | null
  onSelect: (id: string) => void
  /** Linhas extras do mercado escolhido (por exemplo, as vagas dos próximos dias). */
  detail?: (market: T) => ReactNode
}) {
  const search = useMarketSearch(markets)
  // A decisão olha a lista inteira, não a filtrada: os títulos não somem e voltam enquanto se digita.
  const grouped = shouldGroup(markets)
  const wide = useWideScreen()
  // Nasce aberta: o app já abre com um mercado escolhido, mas a lista e a busca são o ponto de partida.
  const [open, setOpen] = useState(true)
  const listId = useId()
  const root = useRef<HTMLElement>(null)
  const toggle = useRef<HTMLButtonElement>(null)
  const moveFocus = useRef<'toggle' | 'search' | null>(null)

  const selected = markets.find((market) => market.id === selectedId)
  // Recolhida só no celular, e só havendo um mercado escolhido para mostrar no lugar da lista.
  const kept = !wide && !open ? selected : undefined
  const collapsed = kept !== undefined

  // A lista some (ou aparece) sob o dedo: o foco vai para onde a pessoa continua.
  useEffect(() => {
    if (moveFocus.current === 'toggle' && collapsed) {
      toggle.current?.focus()
      moveFocus.current = null
    } else if (moveFocus.current === 'search' && !collapsed) {
      root.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
      moveFocus.current = null
    }
  }, [collapsed])

  function choose(id: string) {
    moveFocus.current = 'toggle'
    setOpen(false)
    // Ao reabrir a lista, ela volta inteira: a busca anterior não fica escondendo mercados.
    search.setQuery('')
    if (id !== selectedId) onSelect(id)
  }

  function row(market: T) {
    const isSelected = market.id === selectedId
    const extra = isSelected && detail !== undefined ? detail(market) : null
    return (
      <MarketCard
        name={market.name}
        {...(market.address === null ? {} : { subtitle: market.address })}
        badge={
          <>
            <b className="block text-base font-semibold text-foreground tabular-nums">
              {market.capacity}
            </b>{' '}
            <span>{market.capacity === 1 ? 'estande/dia' : 'estandes/dia'}</span>
          </>
        }
        selected={isSelected}
        onSelect={() => {
          choose(market.id)
        }}
      >
        {extra}
      </MarketCard>
    )
  }

  return (
    <section
      ref={root}
      aria-labelledby={headingId}
      className="rounded-xl border border-border bg-card p-4 lg:sticky lg:top-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id={headingId} className="font-display text-2xl leading-tight font-semibold">
            Mercados
          </h2>
          {!collapsed && <p className="text-muted-foreground">{hint}</p>}
        </div>
        {!wide && selected !== undefined && (
          <Button
            ref={toggle}
            variant="outline"
            aria-expanded={!collapsed}
            aria-controls={listId}
            onClick={() => {
              moveFocus.current = collapsed ? 'search' : 'toggle'
              setOpen(collapsed)
            }}
          >
            {collapsed ? 'Trocar de mercado' : 'Fechar a lista'}
          </Button>
        )}
      </div>

      <div id={listId}>
        {markets.length === 0 ? (
          <p className="mt-3">{emptyMessage}</p>
        ) : kept !== undefined ? (
          <ul className="mt-3 grid gap-2">
            <li>{row(kept)}</li>
          </ul>
        ) : (
          <>
            <MarketSearchField search={search} />
            {search.shown.length === 0 ? (
              <div className="mt-3 grid justify-items-start gap-2">
                <p>Tente outro bairro ou nome, ou veja a lista inteira.</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    search.setQuery('')
                  }}
                >
                  Mostrar todos os mercados
                </Button>
              </div>
            ) : (
              <ul
                aria-label="Lista de mercados"
                className={cn(
                  'mt-3 grid max-h-[min(26rem,55dvh)] overflow-y-auto overscroll-contain pr-1 lg:max-h-[calc(100dvh-15rem)]',
                  grouped ? 'gap-4' : 'gap-2',
                )}
              >
                {grouped
                  ? groupByNeighborhood(search.shown).map((group) => (
                      <li key={group.name ?? ''}>
                        <h3 className="sticky top-0 z-10 flex items-baseline justify-between gap-2 bg-card py-1 text-sm font-semibold">
                          <span>{group.name ?? 'Outros'}</span>
                          <span className="font-normal text-muted-foreground">
                            {plural(group.markets.length, 'mercado', 'mercados')}
                          </span>
                        </h3>
                        <ul className="mt-1 grid gap-2">
                          {group.markets.map((market) => (
                            <li key={market.id}>{row(market)}</li>
                          ))}
                        </ul>
                      </li>
                    ))
                  : search.shown.map((market) => <li key={market.id}>{row(market)}</li>)}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  )
}
