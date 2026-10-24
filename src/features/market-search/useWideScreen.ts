import { useSyncExternalStore } from 'react'

/** O ponto em que as telas passam a ter colunas (o `lg` do Tailwind). */
const WIDE = '(min-width: 1024px)'

function subscribe(onChange: () => void) {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const media = window.matchMedia(WIDE)
  media.addEventListener('change', onChange)
  return () => {
    media.removeEventListener('change', onChange)
  }
}

function snapshot() {
  return typeof window.matchMedia !== 'function' ? true : window.matchMedia(WIDE).matches
}

/** Tela larga (computador, com colunas) ou estreita (celular). Sem como medir, vale como larga. */
export function useWideScreen(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true)
}
