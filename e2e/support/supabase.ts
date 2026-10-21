import { execFileSync } from 'node:child_process'

/**
 * Chaves do Supabase LOCAL (as mesmas de qualquer instalação local, não são segredo). O E2E usa a de
 * serviço só para montar os dados de teste; o app em si roda com a chave pública, como em produção.
 */
export interface LocalSupabase {
  apiUrl: string
  anonKey: string
  serviceKey: string
}

function fromEnv(): LocalSupabase | null {
  const apiUrl = process.env['API_URL']
  const anonKey = process.env['ANON_KEY']
  const serviceKey = process.env['SERVICE_ROLE_KEY']
  return apiUrl && anonKey && serviceKey ? { apiUrl, anonKey, serviceKey } : null
}

/** Pergunta ao CLI (precisa do "npm run db:start" já feito). Falha em silêncio: quem chama explica. */
function fromCli(): LocalSupabase | null {
  try {
    const output = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 30_000,
    })
    const values = new Map<string, string>()
    for (const line of output.split('\n')) {
      const match = /^([A-Z_]+)="(.*)"$/.exec(line.trim())
      if (match?.[1] !== undefined && match[2] !== undefined) values.set(match[1], match[2])
    }
    const apiUrl = values.get('API_URL')
    const anonKey = values.get('ANON_KEY')
    const serviceKey = values.get('SERVICE_ROLE_KEY')
    if (apiUrl === undefined || anonKey === undefined || serviceKey === undefined) return null

    // Os processos de teste nascem depois da config e herdam isto: o CLI roda uma vez só.
    process.env['API_URL'] = apiUrl
    process.env['ANON_KEY'] = anonKey
    process.env['SERVICE_ROLE_KEY'] = serviceKey
    return { apiUrl, anonKey, serviceKey }
  } catch {
    return null
  }
}

/** null quando não há Supabase local rodando nem variáveis API_URL, ANON_KEY e SERVICE_ROLE_KEY. */
export function localSupabase(): LocalSupabase | null {
  return fromEnv() ?? fromCli()
}

export const NO_SUPABASE_MESSAGE =
  'Este teste precisa do Supabase local. Rode "npm run db:start" (ou defina API_URL, ANON_KEY e SERVICE_ROLE_KEY).'
