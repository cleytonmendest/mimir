import { useSyncExternalStore } from 'react'

/** Um controlador com getState e subscribe, como um valor que o React acompanha. */
export function useController<State>(controller: {
  getState(): State
  subscribe(listener: () => void): () => void
}): State {
  return useSyncExternalStore(
    (listener) => controller.subscribe(listener),
    () => controller.getState(),
  )
}
