import { freeSlotsAhead } from '@/domain/booking'
import { MarketPicker } from '@/features/market-search/MarketPicker'
import type { BookingController, ReadyState } from './booking-controller'

/** Os mercados para o fornecedor escolher; o escolhido mostra quantas vagas restam na semana. */
export function MarketList({
  state,
  controller,
}: {
  state: ReadyState
  controller: BookingController
}) {
  return (
    <MarketPicker
      headingId="markets-title"
      hint="Escolha onde quer montar o estande."
      emptyMessage="Nenhum mercado está aceitando reservas por enquanto."
      markets={state.markets}
      selectedId={state.marketId}
      onSelect={(id) => {
        void controller.selectMarket(id)
      }}
      detail={() => {
        if (state.availability === null) return null
        const next7 = freeSlotsAhead(state.availability, 7)
        return (
          <span>
            <b className="font-semibold text-foreground tabular-nums">{next7}</b>{' '}
            {next7 === 1 ? 'vaga livre' : 'vagas livres'} nos próximos 7 dias
          </span>
        )
      }}
    />
  )
}
