import { useSyncExternalStore } from 'react'
import type { BookingController, BookingState } from './booking-controller'

/** O estado do controlador, como um valor que o React acompanha. */
export function useBookingController(controller: BookingController): BookingState {
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
  )
}
