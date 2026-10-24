import { useCallback, useEffect, useState } from 'react'

const PREFIX = 'rascunho:'

type Values = Record<string, string>

/**
 * Lê o rascunho guardado, ou null se não há nenhum com algo escrito. Só campos de texto: tudo o que
 * não for texto é ignorado, e um armazenamento quebrado ou bloqueado vale como "sem rascunho".
 */
function read(key: string, fields: readonly string[]): Values | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    if (raw === null) return null
    const stored: unknown = JSON.parse(raw)
    if (typeof stored !== 'object' || stored === null) return null
    const values: Values = {}
    let written = false
    for (const field of fields) {
      const value = (stored as Record<string, unknown>)[field]
      values[field] = typeof value === 'string' ? value : ''
      if (values[field].trim() !== '') written = true
    }
    return written ? values : null
  } catch {
    return null
  }
}

function write(key: string, values: Values) {
  try {
    if (Object.values(values).every((value) => value.trim() === '')) {
      sessionStorage.removeItem(PREFIX + key)
    } else {
      sessionStorage.setItem(PREFIX + key, JSON.stringify(values))
    }
  } catch {
    // Sem armazenamento (janela privativa, bloqueado ou cheio): a tela funciona do mesmo jeito, só sem rascunho.
  }
}

/** Apaga todos os rascunhos: quem sai da conta não deixa o que digitou para a próxima pessoa. */
export function clearDrafts() {
  try {
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(PREFIX)) sessionStorage.removeItem(key)
    }
  } catch {
    // Sem armazenamento, não há o que apagar.
  }
}

export interface Draft<Field extends string> {
  /** O que a pessoa tinha digitado antes (vazio nos campos sem rascunho). Lido uma vez, ao abrir. */
  initial: Record<Field, string>
  /** Os campos abriram com um rascunho guardado, que ainda não foi descartado nem enviado. */
  recovered: boolean
  /** Apaga o rascunho e esconde o aviso. Quem chama também limpa os campos (ou os acabou de enviar). */
  clear: () => void
}

/**
 * Guarda o que a pessoa digita num formulário (só nesta aba) e devolve, ao reabrir, o que estava
 * escrito: trocar de tela ou recarregar a página não custa o que ela já digitou. Nunca guarde
 * campos secretos (senha, código) aqui. Quem usa chama `useDraftSync` com os valores de agora.
 */
export function useDraft<Field extends string>(
  key: string,
  fields: readonly Field[],
): Draft<Field> {
  const [saved] = useState(() => read(key, fields))
  const [recovered, setRecovered] = useState(saved !== null)
  const clear = useCallback(() => {
    write(key, {})
    setRecovered(false)
  }, [key])
  const initial = Object.fromEntries(
    fields.map((field) => [field, saved?.[field] ?? '']),
  ) as Record<Field, string>
  return { initial, recovered, clear }
}

/** Mantém o rascunho igual ao que está escrito agora; tudo vazio apaga o rascunho. */
export function useDraftSync(key: string, values: Values) {
  const serialized = JSON.stringify(values)
  useEffect(() => {
    write(key, JSON.parse(serialized) as Values)
  }, [key, serialized])
}
