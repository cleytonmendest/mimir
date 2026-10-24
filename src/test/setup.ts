import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// O jsdom não tem ResizeObserver, e o Radix (tooltips) usa para medir o que aparece na tela.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(() => {
  cleanup()
  // Os rascunhos de formulário ficam na sessionStorage: um teste não pode herdar o do anterior.
  // (Os testes das Edge Functions rodam em Node, sem navegador.)
  if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
})
