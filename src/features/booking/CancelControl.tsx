import { Button } from '@/design-system/components/ui/button'
import type { BookingController, ReadyState } from './booking-controller'

/** "Cancelar reserva", com a confirmação ali mesmo: sem janela por cima, no lugar em que se clicou. */
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

  if (!asking) {
    return (
      <Button
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

  return (
    <div
      role="group"
      aria-label="Confirmar cancelamento"
      className="grid w-full gap-2.5 rounded-lg border border-input p-3"
    >
      <p>Cancelar esta reserva? A vaga volta a ficar livre para outros fornecedores.</p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="destructive"
          disabled={state.busy}
          onClick={() => {
            void controller.confirmCancel()
          }}
        >
          Sim, cancelar
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
  )
}
