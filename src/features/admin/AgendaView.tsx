import { useEffect, useState } from 'react'
import { AvailabilityCalendar } from '@/design-system/components/AvailabilityCalendar/AvailabilityCalendar'
import { FailureNotice } from '@/features/diagnostics/FailureNotice'
import { NoticeToast } from '@/features/booking/NoticeToast'
import { MarketPicker } from '@/features/market-search/MarketPicker'
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
      <FailureNotice
        className="mt-6 grid gap-3"
        message={state.message}
        details={state.details}
        onRetry={() => {
          void controller.start()
        }}
      />
    )
  }

  const market = state.markets.find((entry) => entry.id === state.marketId)
  return (
    <>
      <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)_340px] lg:items-start">
        <MarketPicker
          headingId="agenda-markets-title"
          hint="Escolha de qual mercado ver a agenda."
          emptyMessage="Nenhum mercado ativo. Cadastre um na aba Mercados."
          markets={state.markets}
          selectedId={state.marketId}
          onSelect={(id) => {
            void controller.selectMarket(id)
          }}
        />

        <section
          aria-label="Calendário da agenda"
          className="min-w-0 rounded-xl border border-border bg-card p-4 max-sm:-mx-3 max-sm:rounded-none max-sm:border-x-0 max-sm:px-2"
        >
          {state.marketId === null ? (
            <p>Escolha um mercado para ver os dias.</p>
          ) : state.availabilityError !== null ? (
            <FailureNotice
              message={state.availabilityError.message}
              details={state.availabilityError.details}
              onRetry={() => {
                void controller.refresh()
              }}
            />
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
                void controller.selectDay(day)
              }}
              onMonthChange={(month) => {
                controller.changeMonth(month)
              }}
            />
          )}
        </section>

        <div className="grid gap-4">
          <AgendaDayPanel state={state} controller={controller} />
          <UpcomingBookings state={state} />
        </div>
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
