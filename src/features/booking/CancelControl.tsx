import { InlineConfirm } from '@/design-system/components/InlineConfirm/InlineConfirm'
import { useFocusReturn } from '@/design-system/components/InlineConfirm/useFocusReturn'
import { Button } from '@/design-system/components/ui/button'
import { shortDate } from '@/domain/format'
import type { BookingController, ReadyState } from './booking-controller'

/**
 * "Cancelar reserva", com a confirmação ali mesmo (sem janela por cima, no lugar em que se clicou).
 * A confirmação diz qual reserva vai embora e leva o foco para "Manter".
 */
export function CancelControl({
  bookingId,
  where,
  state,
  controller,
}: {
  bookingId: string
  where: 'panel' | 'list'
  state: ReadyState
  controller: BookingController
}) {
  const asking = state.cancelling?.id === bookingId && state.cancelling.where === where
  const trigger = useFocusReturn<HTMLButtonElement>(asking)

  if (!asking) {
    return (
      <Button
        ref={trigger}
        variant="outline"
        className="border-destructive/50 text-destructive"
        disabled={state.busy}
        onClick={() => {
          controller.askCancel(bookingId, where)
        }}
      >
        Cancelar reserva
      </Button>
    )
  }

  const booking = state.myBookings.find((entry) => entry.id === bookingId)
  const what =
    booking === undefined
      ? 'esta reserva'
      : `a reserva de ${shortDate(booking.day)} em ${booking.marketName}`

  return (
    <InlineConfirm
      label="Confirmar cancelamento"
      title={`Cancelar ${what}?`}
      description="A vaga volta a ficar livre para outros fornecedores."
      confirmLabel="Sim, cancelar"
      cancelLabel="Manter"
      busy={state.busy}
      onConfirm={() => {
        void controller.confirmCancel()
      }}
      onCancel={() => {
        controller.keepBooking()
      }}
    />
  )
}
