/** Faltam VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY: erro de implantação, não do usuário. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export type DataErrorCode = 'QUERY_FAILED' | 'INVALID_ROW'

/** O servidor recusou a consulta, ou devolveu uma linha que o domínio não entende. */
export class DataError extends Error {
  readonly code: DataErrorCode

  constructor(code: DataErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DataError'
    this.code = code
  }
}

export type RequestFailureCode = 'NETWORK' | 'AUTH' | 'SERVER' | 'INVALID_RESPONSE'

/**
 * A chamada não chegou a um resultado de negócio.
 * - NETWORK: sem sinal, ou o servidor não respondeu. Tentar de novo quando houver rede.
 * - AUTH: a sessão não vale mais, ou a pessoa não pode fazer isso. Entrar de novo.
 * - SERVER: o servidor falhou. Esperar e repetir.
 * - INVALID_RESPONSE: o servidor respondeu algo que o app não entende (app velho demais?).
 * Recusa de negócio ("lotado", "dia fechado") não é falha: vem como resultado.
 */
export class RequestFailure extends Error {
  readonly code: RequestFailureCode

  constructor(code: RequestFailureCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'RequestFailure'
    this.code = code
  }
}
