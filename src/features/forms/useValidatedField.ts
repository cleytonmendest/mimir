import { useRef, useState, type FocusEvent, type RefObject } from 'react'

/**
 * A última forma de mexer na tela foi pelo teclado (Tab)? Quem toca ou clica num botão tira o foco
 * do campo antes do clique; quem usa Tab não corre esse risco e merece o erro na hora.
 */
let keyboardNavigation = false
if (typeof document !== 'undefined') {
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Tab') keyboardNavigation = true
    },
    true,
  )
  for (const type of ['pointerdown', 'mousedown', 'touchstart']) {
    document.addEventListener(
      type,
      () => {
        keyboardNavigation = false
      },
      true,
    )
  }
}

export interface ValidatedField {
  value: string
  error: string | null
  ref: RefObject<HTMLInputElement | null>
  /** Ao digitar: troca o valor e apaga o erro (a pessoa já está corrigindo). */
  change: (value: string) => void
  /** Ao entrar no campo: o erro sai, para não brigar com quem está digitando. */
  focus: () => void
  /**
   * Ao sair do campo: é aqui que o erro aparece (nunca enquanto se digita). Se a pessoa tocou ou
   * clicou num botão, o erro espera: ele empurraria o botão para baixo no meio do toque e o clique
   * se perderia. O envio confere todos os campos de qualquer jeito. Com Tab, o erro aparece na hora.
   */
  blur: (event?: FocusEvent<HTMLInputElement>) => void
  /** No envio: mostra o erro de agora e diz se o campo está bom. */
  check: () => boolean
  /** Põe o foco no campo sem apagar o erro que acabou de aparecer. */
  focusWithError: () => void
  reset: (value?: string) => void
}

/**
 * Um campo de formulário que só reclama depois que a pessoa sai dele: nunca enquanto digita num
 * campo intocado, e o erro some assim que ela volta para corrigir. Quem confere é `validate`
 * (a regra do domínio): devolve a mensagem, ou null se está bom.
 */
export function useValidatedField(
  validate: (value: string) => string | null,
  initial = '',
): ValidatedField {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLInputElement>(null)
  const keepError = useRef(false)

  return {
    value,
    error,
    ref,
    change: (next) => {
      setValue(next)
      setError(null)
    },
    focus: () => {
      if (keepError.current) return
      setError(null)
    },
    blur: (event) => {
      const next = event?.relatedTarget
      if (!keyboardNavigation && next instanceof HTMLElement && next.tagName === 'BUTTON') return
      setError(validate(value))
    },
    check: () => {
      const problem = validate(value)
      setError(problem)
      return problem === null
    },
    focusWithError: () => {
      keepError.current = true
      ref.current?.focus()
      keepError.current = false
    },
    reset: (next = '') => {
      setValue(next)
      setError(null)
    },
  }
}

/**
 * No envio: confere todos os campos (cada um mostra o seu erro) e leva o foco ao primeiro que
 * está errado. Devolve true quando está tudo certo e o envio pode seguir.
 */
export function checkAll(fields: readonly ValidatedField[]): boolean {
  const results = fields.map((field) => field.check())
  const firstWrong = results.indexOf(false)
  if (firstWrong === -1) return true
  fields[firstWrong]?.focusWithError()
  return false
}
