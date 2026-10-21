import { freeSlotsAhead } from '@/domain/booking'
import { MarketCard } from '@/design-system/components/MarketCard/MarketCard'
import type { BookingController, ReadyState } from './booking-controller'

export function MarketList({
  state,
  controller,
}: {
  state: ReadyState
  controller: BookingController
}) {
  return (
    <section
      aria-labelledby="markets-title"
      className="rounded-xl border border-border bg-card p-4 lg:[grid-area:mk]"
    >
      <h2 id="markets-title" className="font-display text-2xl leading-tight font-semibold">
        Mercados
      </h2>
      <p className="text-muted-foreground">Escolha onde quer montar o estande.</p>
      {state.markets.length === 0 ? (
        <p className="mt-3">Nenhum mercado está aceitando reservas por enquanto.</p>
      ) : (
        <div className="mt-3 grid gap-2.5">
          {state.markets.map((entry) => {
            const selected = entry.id === state.marketId
            const next7 =
              selected && state.availability !== null ? freeSlotsAhead(state.availability, 7) : null
            return (
              <MarketCard
                key={entry.id}
                name={entry.name}
                {...(entry.address === null ? {} : { subtitle: entry.address })}
                selected={selected}
                onSelect={() => {
                  void controller.selectMarket(entry.id)
                }}
              >
                <span>
                  <b className="font-semibold text-foreground tabular-nums">{entry.capacity}</b>{' '}
                  {entry.capacity === 1 ? 'estande por dia' : 'estandes por dia'}
                </span>
                {next7 !== null && (
                  <span>
                    <b className="font-semibold text-foreground tabular-nums">{next7}</b>{' '}
                    {next7 === 1 ? 'vaga livre' : 'vagas livres'} nos próximos 7 dias
                  </span>
                )}
              </MarketCard>
            )
          })}
        </div>
      )}
    </section>
  )
}
