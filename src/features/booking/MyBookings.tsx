import { useState } from 'react'
import { shortDate } from '@/domain/format'
import { Button } from '@/design-system/components/ui/button'
import { useWideScreen } from '@/features/market-search/useWideScreen'
import type { BookingController, ReadyState } from './booking-controller'
import { CancelControl } from './CancelControl'

/** Quantas reservas aparecem de saída (uma por coluna); as outras ficam atrás de "Ver todas". */
const VISIBLE_WIDE = 3
const VISIBLE_NARROW = 2

/**
 * As reservas de quem está logado, no topo da tela: é a primeira coisa que o fornecedor quer saber
 * ("onde monto o estande amanhã?") e o lugar onde cancela.
 */
export function MyBookings({
  state,
  controller,
}: {
  state: ReadyState
  controller: BookingController
}) {
  const [all, setAll] = useState(false)
  const visible = useWideScreen() ? VISIBLE_WIDE : VISIBLE_NARROW
  const bookings = state.myBookings
  const shown = all ? bookings : bookings.slice(0, visible)

  return (
    <section aria-labelledby="mine-title" className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id="mine-title" className="font-display text-2xl leading-tight font-semibold">
          Minhas reservas
        </h2>
        {bookings.length > visible && (
          <Button
            variant="outline"
            aria-expanded={all}
            onClick={() => {
              setAll(!all)
            }}
          >
            {all ? 'Mostrar menos' : `Ver todas (${bookings.length})`}
          </Button>
        )}
      </div>
      {bookings.length === 0 ? (
        <>
          <p className="text-muted-foreground">Você ainda não tem reservas.</p>
          <p className="text-muted-foreground">
            Escolha um mercado e um dia abaixo para fazer a primeira.
          </p>
        </>
      ) : (
        <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((booking) => (
            <li
              key={booking.id}
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-border px-3 py-2"
            >
              <button
                type="button"
                onClick={() => {
                  void controller.goToBooking(booking.id)
                }}
                className="grid min-h-11 min-w-0 flex-1 content-center rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
              >
                <span className="font-display text-xl leading-tight font-semibold tabular-nums">
                  {shortDate(booking.day)}
                </span>{' '}
                <span className="text-sm leading-snug text-muted-foreground">
                  {booking.marketName}
                </span>
                {/* O nome do botão é o que se vê (WCAG 2.5.3), mais o que ele faz, só para leitor de tela. */}
                <span className="sr-only">: ver no calendário</span>
              </button>
              <CancelControl
                bookingId={booking.id}
                where="list"
                state={state}
                controller={controller}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
