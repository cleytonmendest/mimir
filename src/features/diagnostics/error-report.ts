/** Quantas causas encadeadas (error.cause) entram no relatório; além disso é só ruído. */
const MAX_CAUSES = 3

function describeOne(error: unknown): string {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? ` ${error.code}` : ''
    return `${error.name}${code}: ${error.message}`
  }
  return typeof error === 'string' ? error : 'Erro sem detalhes'
}

/**
 * O lado técnico de um erro, para quem dá suporte: o tipo, o código e a mensagem do erro e de suas
 * causas, uma por linha. Não é para ser mostrado: a pessoa lê a frase de `describeFailure`.
 */
export function describeError(error: unknown): string {
  const lines: string[] = []
  let current: unknown = error
  for (let depth = 0; depth <= MAX_CAUSES; depth += 1) {
    lines.push(depth === 0 ? describeOne(current) : `Causa: ${describeOne(current)}`)
    if (!(current instanceof Error) || current.cause === undefined) break
    current = current.cause
  }
  return lines.join('\n')
}

/**
 * Um erro como a tela o mostra (`message`, a frase para a pessoa) mais o lado técnico (`details`,
 * que pode faltar quando o servidor só recusou, sem exceção).
 */
export interface Failure {
  message: string
  details: string | null
}

/**
 * O texto que a pessoa copia e cola numa conversa de suporte: quando, onde, em que versão e o que
 * falhou. O endereço vai sem a query (?token=...) e sem o hash: links de acesso não vazam.
 */
export function buildErrorReport(input: {
  message: string
  details: string | null
  at: Date
  path: string
  version: string
}): string {
  return [
    'Detalhes do erro - Agenda de Degustações',
    `Quando: ${input.at.toISOString()}`,
    `Tela: ${input.path}`,
    `Versão: ${input.version}`,
    `O que a tela disse: ${input.message}`,
    ...(input.details === null ? [] : [input.details]),
  ].join('\n')
}
