/** Faltam VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY: erro de implantação, não do usuário. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

export type DataErrorCode = 'QUERY_FAILED' | 'INVALID_ROW' | 'CONFLICT'

/**
 * O servidor recusou a consulta, devolveu uma linha que o domínio não entende, ou (CONFLICT) a
 * visita mudou no servidor depois que a tela a carregou: quem manda é o servidor, a tela recarrega.
 */
export class DataError extends Error {
  readonly code: DataErrorCode

  constructor(code: DataErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'DataError'
    this.code = code
  }
}
