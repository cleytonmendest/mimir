import { useEffect, useState } from 'react'
import { AvailabilityCalendar } from '@/design-system/components/AvailabilityCalendar/AvailabilityCalendar'
import { MarketCard } from '@/design-system/components/MarketCard/MarketCard'
import { Button } from '@/design-system/components/ui/button'
import { NoticeToast } from '@/features/booking/NoticeToast'
import type { BookingGateway } from '@/lib/supabase/booking-gateway'
import { createAgendaController } from './agenda-controller'
import { AgendaDayPanel } from './AgendaDayPanel'
import { UpcomingBookings } from './UpcomingBookings'
import { useController } from './useController'

/** A agenda do administrador: o calendário de cada mercado, quem reservou, e fechar datas. */
export function AgendaView({ gateway, now }: { gateway: BookingGateway; now?: () => Date }) {
  const [controller] = useState(() =>
    createAgendaController({ gateway, ...(now === undefined ? {} : { now }) }),
  )
  const state = useController(controller)

  useEffect(() => {
    void controller.start()
    const onVisible = () => {
      if (document.visibilityState === 'visible') void controller.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [controller])

  if (state.status === 'loading') {
    return (
      <p role="status" className="mt-6 text-muted-foreground">
        Carregando…
      </p>
    )
  }

  if (state.status === 'failed') {
    return (
      <div className="mt-6 grid gap-3">
        <p role="alert" className="text-destructive">
          {state.message}
        </p>
        <div>
          <Button
            onClick={() => {
              void controller.start()
            }}
          >
            Tentar de novo
          </Button>
        </div>
      </div>
    )
  }

  const market = state.markets.find((entry) => entry.id === state.marketId)
  return (
    <>
      <div className="mt-4 grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)_340px] lg:items-start lg:[grid-template-areas:'mk_cal_pn'_'mine_cal_pn']">
        <section
          aria-labelledby="agenda-markets-title"
          className="rounded-xl border border-border bg-card p-4 lg:[grid-area:mk]"
        >
          <h2
            id="agenda-markets-title"
            className="font-display text-2xl leading-tight font-semibold"
          >
            Mercados
          </h2>
          <p className="text-muted-foreground">Escolha de qual mercado ver a agenda.</p>
          {state.markets.length === 0 ? (
            <p className="mt-3">Nenhum mercado ativo. Cadastre um na aba Mercados.</p>
          ) : (
            <div className="mt-3 grid gap-2.5">
              {state.markets.map((entry) => (
                <MarketCard
                  key={entry.id}
                  name={entry.name}
                  {...(entry.address === null ? {} : { subtitle: entry.address })}
                  selected={entry.id === state.marketId}
                  onSelect={() => {
                    void controller.selectMarket(entry.id)
                  }}
                >
                  <span>
                    <b className="font-semibold text-foreground tabular-nums">{entry.capacity}</b>{' '}
                    {entry.capacity === 1 ? 'estande por dia' : 'estandes por dia'}
                  </span>
                </MarketCard>
              ))}
            </div>
          )}
        </section>

        <section
          aria-label="Calendário da agenda"
          className="min-w-0 rounded-xl border border-border bg-card p-4 lg:[grid-area:cal]"
        >
          {state.marketId === null ? (
            <p>Escolha um mercado para ver os dias.</p>
          ) : state.availabilityError !== null ? (
            <div className="grid gap-3">
              <p role="alert" className="text-destructive">
                {state.availabilityError}
              </p>
              <div>
                <Button
                  onClick={() => {
                    void controller.refresh()
                  }}
                >
                  Tentar de novo
                </Button>
              </div>
            </div>
          ) : state.availability === null ? (
            <p role="status" className="text-muted-foreground">
              Carregando o calendário…
            </p>
          ) : (
            <AvailabilityCalendar
              month={state.month}
              today={state.availability.today}
              capacity={state.availability.capacity}
              days={state.availability.days}
              selected={state.selectedDay}
              subtitle={market?.name ?? ''}
              onSelect={(day) => {
                controller.selectDay(day)
              }}
              onMonthChange={(month) => {
                controller.changeMonth(month)
              }}
            />
          )}
        </section>

        <AgendaDayPanel state={state} controller={controller} />
        <UpcomingBookings state={state} />
      </div>
      <NoticeToast
        notice={state.notice}
        onClose={() => {
          controller.dismissNotice()
        }}
      />
    </>
  )
}
