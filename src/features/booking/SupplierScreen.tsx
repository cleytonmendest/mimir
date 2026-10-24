import { useEffect, useState } from 'react'
import { AvailabilityCalendar } from '@/design-system/components/AvailabilityCalendar/AvailabilityCalendar'
import { FailureNotice } from '@/features/diagnostics/FailureNotice'
import type { BookingGateway } from '@/lib/supabase/booking-gateway'
import { createBookingController } from './booking-controller'
import { DayPanel } from './DayPanel'
import { MarketList } from './MarketList'
import { MyBookings } from './MyBookings'
import { NoticeToast } from './NoticeToast'
import { useBookingController } from './useBookingController'

/** A área do fornecedor: escolhe o mercado, vê o calendário, reserva e cancela. */
export function SupplierScreen({ gateway, now }: { gateway: BookingGateway; now?: () => Date }) {
  const [controller] = useState(() =>
    createBookingController({ gateway, ...(now === undefined ? {} : { now }) }),
  )
  const state = useBookingController(controller)

  useEffect(() => {
    void controller.start()
    // A tela pode ter ficado aberta enquanto outros reservavam: ao voltar, mostra o que mudou.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void controller.refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [controller])

  return (
    <section className="mt-4" aria-labelledby="bookings-title">
      <h2 id="bookings-title" className="font-display text-3xl font-semibold">
        Reservas
      </h2>
      <p className="mt-1 max-w-[64ch] text-muted-foreground">
        Reserve um estande de degustação no mercado e no dia que quiser.
      </p>

      {state.status === 'loading' && (
        <p role="status" className="mt-6 text-muted-foreground">
          Carregando…
        </p>
      )}

      {state.status === 'failed' && (
        <FailureNotice
          className="mt-6 grid gap-3"
          message={state.message}
          details={state.details}
          onRetry={() => {
            void controller.start()
          }}
        />
      )}

      {state.status === 'ready' && (
        <>
          <div className="mt-4">
            <MyBookings state={state} controller={controller} />
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)_320px] lg:items-start">
            <MarketList state={state} controller={controller} />

            <section
              aria-label="Calendário de reservas"
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
                  showMine
                  subtitle={state.markets.find((entry) => entry.id === state.marketId)?.name ?? ''}
                  onSelect={(day) => {
                    controller.selectDay(day)
                  }}
                  onMonthChange={(month) => {
                    controller.changeMonth(month)
                  }}
                />
              )}
            </section>

            <DayPanel state={state} controller={controller} />
          </div>
          <NoticeToast
            notice={state.notice}
            onClose={() => {
              controller.dismissNotice()
            }}
          />
        </>
      )}
    </section>
  )
}
