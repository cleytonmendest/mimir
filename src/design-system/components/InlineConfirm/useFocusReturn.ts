import { useEffect, useRef } from 'react'

/**
 * Para quem abriu uma confirmação: devolve o foco ao botão que a abriu quando ela se fecha sem
 * apagar nada. Sem isso, o botão some quando a confirmação aparece e o foco do teclado cai na página.
 * Ligue o `ref` devolvido ao botão que abre a confirmação.
 */
export function useFocusReturn<T extends HTMLElement>(open: boolean) {
  const trigger = useRef<T>(null)
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open && document.activeElement === document.body) {
      trigger.current?.focus()
    }
    wasOpen.current = open
  }, [open])
  return trigger
}
