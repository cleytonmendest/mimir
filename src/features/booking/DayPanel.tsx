import { useEffect, useRef, type ReactNode } from 'react'
import { dayStatus, freeSlots } from '@/domain/booking'
import { dayMonth, longDate, plural } from '@/domain/format'
import { SlotMeter } from '@/design-system/components/SlotMeter/SlotMeter'
import { Button } from '@/design-system/components/ui/button'
import { cn } from '@/design-system/utils'
import type { BookingController, ReadyState } from './booking-controller'
import { CancelControl } from './CancelControl'

const CARD = 'rounded-xl border border-border bg-card p-4 lg:[grid-area:pn]'

/** O dia escolhido no calendário: quantas vagas, e o que dá para fazer com ele. */
export function DayPanel({
  state,
  controller,
}: {
  state: ReadyState
  controller: BookingController
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
      <section ref={panel} aria-labelledby="day-title" className={CARD}>
        <h2 id="day-title" className="font-display text-2xl leading-tight font-semibold">
          Dia escolhido
        </h2>
        <p className="text-muted-foreground">
          Escolha um dia no calendário. Dias verdes e amarelos têm vaga.
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
  const mine = state.myBookings.find(
    (booking) => booking.marketId === state.marketId && booking.day === selectedDay,
  )
  const free = freeSlots(availability.capacity, entry.booked)

  return (
    <section ref={panel} aria-labelledby="day-title" className={CARD}>
      <h2 id="day-title" className="font-display text-2xl leading-tight font-semibold">
        {longDate(selectedDay)}
      </h2>
      <p className="text-muted-foreground">
        {market?.name}
        {market?.address != null && ` · ${market.address}`}
      </p>

      <div className="mt-3">
        <SlotMeter size="lg" booked={entry.booked} capacity={availability.capacity} />
      </div>
      <p className="mt-2 font-display text-[22px] font-semibold tabular-nums">
        {status === 'closed'
          ? 'Fechado'
          : `${plural(free, 'vaga livre', 'vagas livres')} de ${availability.capacity}`}
      </p>

      <div className="mt-3.5 grid gap-2.5">
        {entry.mine ? (
          <>
            <Notice tone="free">Você tem uma reserva neste dia.</Notice>
            {mine !== undefined && (
              <CancelControl
                bookingId={mine.id}
                where="panel"
                state={state}
                controller={controller}
              />
            )}
          </>
        ) : status === 'closed' ? (
          <Notice tone="closed">Este dia está fechado para reservas neste mercado.</Notice>
        ) : status === 'past' || status === 'far' ? (
          <Notice tone="closed">Este dia não aceita reservas.</Notice>
        ) : status === 'full' ? (
          <>
            <Notice tone="full">
              Lotado. Os {availability.capacity} estandes deste dia já estão reservados. Escolha
              outro dia.
            </Notice>
            <Button disabled>Reservar este dia</Button>
          </>
        ) : state.confirming ? (
          <div
            role="group"
            aria-label="Confirmar reserva"
            className="grid gap-2.5 rounded-lg border border-input p-3"
          >
            <p>
              Reservar um estande em <strong>{market?.name}</strong> no dia{' '}
              <strong>{dayMonth(selectedDay)}</strong>?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={state.busy}
                onClick={() => {
                  void controller.confirmBooking()
                }}
              >
                Confirmar reserva
              </Button>
              <Button
                variant="outline"
                disabled={state.busy}
                onClick={() => {
                  controller.backFromConfirm()
                }}
              >
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <Button
            onClick={() => {
              controller.startBooking()
            }}
          >
            Reservar este dia
          </Button>
        )}
      </div>
    </section>
  )
}

const TONES = {
  free: 'bg-slot-free-bg text-slot-free',
  full: 'bg-slot-full-bg text-slot-full',
  closed: 'bg-slot-closed-bg text-foreground',
} as const

function Notice({ tone, children }: { tone: keyof typeof TONES; children: ReactNode }) {
  return <p className={cn('rounded-lg px-3 py-2.5 font-medium', TONES[tone])}>{children}</p>
}
