import type { Deps } from './deps.ts'

/**
 * O app chama estas funções do navegador, de outra origem. Não há cookie: a identidade vai no
 * cabeçalho Authorization, então liberar qualquer origem não abre nada que o token não feche.
 */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
}

/** Resposta de recusa: `error` é o código que o app entende; `message` é para a pessoa. */
export function fail(status: number, error: string, message?: string): Response {
  return json(status, message === undefined ? { error } : { error, message })
}

/** O Supabase (Auth, API) respondeu algo inesperado ou não respondeu. */
export class UpstreamError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'UpstreamError'
  }
}

const MAX_BODY_BYTES = 4096

/** O corpo como objeto JSON, ou null se vier vazio, grande demais ou malformado. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown> | null> {
  let text: string
  try {
    text = await req.text()
  } catch {
    return null
  }
  if (text.length > MAX_BODY_BYTES) return null
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export type Handler = (req: Request, deps: Deps) => Promise<Response>

/**
 * Casca comum: responde ao preflight do navegador, só aceita POST e transforma qualquer falha
 * inesperada em resposta (o detalhe vai para o log, nunca para quem chamou).
 */
export function endpoint(handler: Handler): Handler {
  return async (req, deps) => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
    if (req.method !== 'POST') return fail(405, 'METHOD_NOT_ALLOWED')
    try {
      return await handler(req, deps)
    } catch (error) {
      console.error(error)
      return error instanceof UpstreamError
        ? fail(502, 'UPSTREAM', 'O servidor de contas não respondeu. Tente de novo em instantes.')
        : fail(500, 'SERVER_ERROR', 'Algo deu errado. Tente de novo.')
    }
  }
}
