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

export type SyncFailureCode = 'NETWORK' | 'AUTH' | 'SERVER' | 'BAD_REQUEST' | 'INVALID_RESPONSE'

/**
 * O envio de eventos não chegou a um resultado. Nada se perde: a fila local guarda os eventos e o
 * servidor é idempotente, então reenviar é sempre seguro.
 * - NETWORK: sem sinal, ou o servidor não respondeu a tempo. Tentar de novo quando houver rede.
 * - AUTH: a sessão não vale mais. Renovar a sessão (ou entrar de novo) antes de tentar.
 * - SERVER: o servidor falhou ou ainda não tem a função (implantação em andamento). Esperar e repetir.
 * - BAD_REQUEST: o servidor recusou o envio inteiro por um defeito deste app. Repetir não resolve.
 * - INVALID_RESPONSE: o servidor respondeu algo que o app não entende (versão nova demais?).
 */
export class SyncFailure extends Error {
  readonly code: SyncFailureCode

  constructor(code: SyncFailureCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SyncFailure'
    this.code = code
  }
}
