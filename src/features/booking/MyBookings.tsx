import { shortDate } from '@/domain/format'
import type { BookingController, ReadyState } from './booking-controller'
import { CancelControl } from './CancelControl'

export function MyBookings({
  state,
  controller,
}: {
  state: ReadyState
  controller: BookingController
}) {
  return (
    <section
      aria-labelledby="mine-title"
      className="rounded-xl border border-border bg-card p-4 lg:[grid-area:mine]"
    >
      <h2 id="mine-title" className="font-display text-2xl leading-tight font-semibold">
        Minhas reservas
      </h2>
      {state.myBookings.length === 0 ? (
        <p className="text-muted-foreground">Você ainda não tem reservas.</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {state.myBookings.map((booking) => (
            <li key={booking.id} className="grid gap-2 rounded-lg border border-border p-3">
              <button
                type="button"
                onClick={() => {
                  void controller.goToBooking(booking.id)
                }}
                className="grid min-h-11 content-center rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring"
              >
                <span className="font-display text-xl font-semibold tabular-nums">
                  {shortDate(booking.day)}
                </span>{' '}
                <span className="text-sm text-muted-foreground">{booking.marketName}</span>
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
