import { useEffect, useRef } from 'react'
import { dayStatus, freeSlots } from '@/domain/booking'
import { longDate, plural } from '@/domain/format'
import { SlotMeter } from '@/design-system/components/SlotMeter/SlotMeter'
import { Button } from '@/design-system/components/ui/button'
import { Input } from '@/design-system/components/ui/input'
import { Label } from '@/design-system/components/ui/label'
import type { AgendaController, AgendaReady } from './agenda-controller'

const CARD = 'rounded-xl border border-border bg-card p-4'

/** O dia escolhido, para o administrador: quem reservou, e fechar ou liberar a data. */
export function AgendaDayPanel({
  state,
  controller,
}: {
  state: AgendaReady
  controller: AgendaController
}) {
  const { selectedDay, availability } = state
  const panel = useRef<HTMLElement>(null)

  // No celular o painel fica abaixo do calendário: leva até ele quando se escolhe um dia.
  useEffect(() => {
    if (selectedDay === null) return
    if (typeof window.matchMedia !== 'function') return
    if (!window.matchMedia('(max-width: 1023px)').matches) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    panel.current?.scrollIntoView?.({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [selectedDay])

  if (selectedDay === null || availability === null) {
    return (
      <section ref={panel} aria-labelledby="agenda-day-title" className={CARD}>
        <h2 id="agenda-day-title" className="font-display text-2xl leading-tight font-semibold">
          Dia escolhido
        </h2>
        <p className="text-muted-foreground">
          Escolha um dia no calendário para ver quem reservou e, se precisar, fechar a data.
        </p>
      </section>
    )
  }

  const entry = availability.days.find((candidate) => candidate.day === selectedDay) ?? {
    day: selectedDay,
    booked: 0,
    closed: false,
    mine: false,
  }
  const status = dayStatus({
    today: availability.today,
    day: selectedDay,
    closed: entry.closed,
    booked: entry.booked,
    capacity: availability.capacity,
  })
  const market = state.markets.find((candidate) => candidate.id === state.marketId)
  const here = state.dayBookings
  const closedReason = state.closedDays.find((closed) => closed.day === selectedDay)?.reason
  const free = freeSlots(availability.capacity, entry.booked)
  const canChange = status !== 'past' && status !== 'far'

  return (
    <section ref={panel} aria-labelledby="agenda-day-title" className={CARD}>
      <h2 id="agenda-day-title" className="font-display text-2xl leading-tight font-semibold">
        {longDate(selectedDay)}
      </h2>
      <p className="text-muted-foreground">{market?.name}</p>

      <div className="mt-3">
        <SlotMeter size="lg" booked={entry.booked} capacity={availability.capacity} />
      </div>
      <p className="mt-2 font-display text-[22px] font-semibold tabular-nums">
        {entry.closed
          ? 'Fechado para novas reservas'
          : `${plural(free, 'vaga livre', 'vagas livres')} de ${availability.capacity}`}
      </p>
      {entry.closed && closedReason != null && (
        <p className="text-muted-foreground">Motivo: {closedReason}</p>
      )}

      <h3 className="mt-4 text-sm font-semibold tracking-wider text-muted-foreground uppercase">
        Quem reservou
      </h3>
      {state.dayError !== null ? (
        <p role="alert" className="mt-2 text-destructive">
          {state.dayError}
        </p>
      ) : here === null ? (
        <p role="status" className="mt-2 text-muted-foreground">
          Carregando…
        </p>
      ) : here.length === 0 ? (
        <p className="mt-2 text-muted-foreground">Nenhuma reserva neste dia.</p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {here.map((booking) => {
            const asking = state.cancelling?.id === booking.id
            return (
              <li key={booking.id} className="grid gap-2 rounded-md border border-border p-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {booking.supplierName || 'Fornecedor sem nome'}
                  </span>
                  {!asking && canChange && (
                    <Button
                      variant="outline"
                      className="border-destructive/50 text-destructive"
                      disabled={state.busy}
                      aria-label={`Cancelar a reserva de ${booking.supplierName || 'fornecedor sem nome'}`}
                      onClick={() => {
                        controller.askCancel(booking.id)
                      }}
                    >
                      Cancelar
                    </Button>
                  )}
                </div>
                {asking && state.cancelling !== null && (
                  <div role="group" aria-label="Confirmar cancelamento" className="grid gap-2">
                    <Label htmlFor="cancel-reason">Motivo (opcional)</Label>
                    <Input
                      id="cancel-reason"
                      value={state.cancelling.reason}
                      maxLength={500}
                      onChange={(event) => {
                        controller.setCancelReason(event.target.value)
                      }}
                    />
                    <p className="text-sm text-muted-foreground">
                      O sistema não avisa o fornecedor: combine com ele.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="destructive"
                        disabled={state.busy}
                        onClick={() => {
                          void controller.confirmCancel()
                        }}
                      >
                        Cancelar reserva
                      </Button>
                      <Button
                        variant="outline"
                        disabled={state.busy}
                        onClick={() => {
                          controller.keepBooking()
                        }}
                      >
                        Manter
                      </Button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canChange && (
        <div className="mt-4 grid gap-2">
          {!entry.closed && (
            <>
              <Label htmlFor="close-reason">Motivo, se for fechar (opcional)</Label>
              <Input
                id="close-reason"
                value={state.closeReason}
                maxLength={200}
                placeholder="Feriado, inventário…"
                onChange={(event) => {
                  controller.setCloseReason(event.target.value)
                }}
              />
            </>
          )}
          <Button
            variant="outline"
            disabled={state.busy}
            onClick={() => {
              void controller.toggleClosed()
            }}
          >
            {entry.closed ? 'Liberar este dia' : 'Fechar este dia para novas reservas'}
          </Button>
          <p className="text-sm text-muted-foreground">
            Fechar vale só para reservas novas: as já feitas continuam valendo.
          </p>
        </div>
      )}
    </section>
  )
}
