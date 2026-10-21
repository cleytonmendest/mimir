import { shortDate } from '@/domain/format'
import type { AgendaReady } from './agenda-controller'

/** As próximas reservas de todos os mercados, só para consulta. */
export function UpcomingBookings({ state }: { state: AgendaReady }) {
  const upcoming = state.bookings.slice(0, 8)
  return (
    <section
      aria-labelledby="upcoming-title"
      className="rounded-xl border border-border bg-card p-4 lg:[grid-area:mine]"
    >
      <h2 id="upcoming-title" className="font-display text-2xl leading-tight font-semibold">
        Próximas reservas
      </h2>
      <p className="text-muted-foreground">Todos os mercados. Só para consulta.</p>
      {upcoming.length === 0 ? (
        <p className="mt-3">Ainda não há reservas.</p>
      ) : (
        <ul className="mt-3 grid">
          {upcoming.map((booking) => (
            <li
              key={booking.id}
              className="grid grid-cols-[auto_1fr] gap-x-3 border-t border-border py-2 first:border-t-0"
            >
              <span className="row-span-2 self-center font-display text-lg font-semibold tabular-nums">
                {shortDate(booking.day)}
              </span>
              <span className="font-semibold">{booking.supplierName || 'Fornecedor sem nome'}</span>
              <span className="text-sm text-muted-foreground">{booking.marketName}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
