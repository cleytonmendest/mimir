import type { Deps } from './deps.ts'
import type { ProfileRow } from './supabase-api.ts'

/**
 * Apoio só para testes: um Supabase de brinquedo em memória (Auth, is_admin e as tabelas que as
 * funções tocam), que responde como o de verdade e RECUSA o que o de verdade recusaria, por
 * exemplo chamar o Auth de administração sem a chave de serviço.
 */
export const ANON_KEY = 'anon-key'
export const SERVICE_KEY = 'service-key'

export interface FakeUser {
  id: string
  email: string
  password: string | null
  confirmed: boolean
  fullName: string
}

export interface FakeAttempt {
  ip_hash: string
  email_hash: string
  outcome: string
  at: Date
}

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  return new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
}

export function createFakeSupabase() {
  const users = new Map<string, FakeUser>()
  const profiles = new Map<string, ProfileRow>()
  const tokens = new Map<string, string>()
  const settings: { mode: 'closed' | 'invite' | 'open'; invite_code: string | null } = {
    mode: 'closed',
    invite_code: null,
  }
  const attempts: FakeAttempt[] = []
  const calls: string[] = []
  const faults = { generateLink: false, network: false, purge: false }
  let clock = new Date('2026-10-22T12:00:00Z')
  let sequence = 0

  function addUser(input: {
    email: string
    fullName?: string
    role?: 'admin' | 'supplier'
    deactivated?: boolean
    password?: string
  }): { id: string; token: string } {
    sequence += 1
    const id = `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`
    const fullName = input.fullName ?? input.email
    users.set(id, {
      id,
      email: input.email,
      password: input.password ?? null,
      confirmed: true,
      fullName,
    })
    profiles.set(id, {
      id,
      role: input.role ?? 'supplier',
      email: input.email,
      full_name: fullName,
      deactivated_at: input.deactivated === true ? clock.toISOString() : null,
    })
    const token = `token-of-${id}`
    tokens.set(token, id)
    return { id, token }
  }

  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(body === null ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    })

  function bearer(init: RequestInit | undefined): string {
    const headers = new Headers(init?.headers)
    return /^Bearer (.*)$/.exec(headers.get('Authorization') ?? '')?.[1] ?? ''
  }

  const fetchFake: typeof fetch = (input, init) => {
    if (faults.network) return Promise.reject(new TypeError('rede fora do ar'))
    const url = urlOf(input)
    const method = init?.method ?? 'GET'
    const route = `${method} ${url.pathname}`
    calls.push(route)
    const authorization = bearer(init)
    const asService = authorization === SERVICE_KEY
    const body: Record<string, unknown> =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {}

    if (route === 'GET /auth/v1/user') {
      const userId = tokens.get(authorization)
      if (userId === undefined)
        return Promise.resolve(reply(authorization === ANON_KEY ? 403 : 401, { msg: 'bad jwt' }))
      return Promise.resolve(reply(200, { id: userId }))
    }

    if (route === 'POST /rest/v1/rpc/is_admin') {
      const userId = tokens.get(authorization)
      if (userId === undefined) return Promise.resolve(reply(401, { message: 'JWT' }))
      const profile = profiles.get(userId)
      return Promise.resolve(
        reply(200, profile?.role === 'admin' && profile.deactivated_at === null),
      )
    }

    // Daqui para baixo é só com a chave de serviço, como no Supabase de verdade.
    if (!asService) return Promise.resolve(reply(401, { message: 'service key required' }))

    if (route === 'POST /auth/v1/admin/users') {
      const email = String(body['email'])
      if ([...users.values()].some((user) => user.email === email)) {
        return Promise.resolve(reply(422, { error_code: 'email_exists' }))
      }
      const password = typeof body['password'] === 'string' ? body['password'] : null
      if (password === 'senha-fraquissima') {
        return Promise.resolve(reply(422, { error_code: 'weak_password' }))
      }
      const metadata = body['user_metadata'] as { full_name?: string } | undefined
      const created = addUser({
        email,
        ...(metadata?.full_name === undefined ? {} : { fullName: metadata.full_name }),
        ...(password === null ? {} : { password }),
      })
      const user = users.get(created.id)
      if (user) user.confirmed = body['email_confirm'] === true
      return Promise.resolve(reply(200, { id: created.id, email }))
    }

    if (route === 'POST /auth/v1/admin/generate_link') {
      if (faults.generateLink) return Promise.resolve(reply(500, { msg: 'smtp' }))
      const email = String(body['email'])
      const exists = [...users.values()].some((user) => user.email === email)
      return Promise.resolve(
        exists
          ? reply(200, { hashed_token: `hashed-${email}`, action_link: 'http://x/verify' })
          : reply(404, { error_code: 'user_not_found' }),
      )
    }

    if (method === 'DELETE' && url.pathname.startsWith('/auth/v1/admin/users/')) {
      const id = url.pathname.split('/').pop() ?? ''
      users.delete(id)
      profiles.delete(id)
      return Promise.resolve(reply(200, {}))
    }

    if (route === 'GET /rest/v1/profiles') {
      const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '')
      const email = (url.searchParams.get('email') ?? '').replace(/^eq\./, '')
      const row =
        id === ''
          ? [...profiles.values()].find((profile) => profile.email === email)
          : profiles.get(id)
      return Promise.resolve(reply(200, row === undefined ? [] : [row]))
    }

    if (route === 'PATCH /rest/v1/profiles') {
      const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '')
      const row = profiles.get(id)
      if (row !== undefined && (body['role'] === 'admin' || body['role'] === 'supplier')) {
        row.role = body['role']
      }
      return Promise.resolve(reply(204, null))
    }

    if (route === 'GET /rest/v1/signup_settings') return Promise.resolve(reply(200, [settings]))

    if (route === 'GET /rest/v1/signup_attempts') {
      const column = url.searchParams.has('ip_hash') ? 'ip_hash' : 'email_hash'
      const wanted = (url.searchParams.get(column) ?? '').replace(/^eq\./, '')
      const since = new Date((url.searchParams.get('at') ?? '').replace(/^gte\./, ''))
      const total = attempts.filter((a) => a[column] === wanted && a.at >= since).length
      return Promise.resolve(reply(206, [], { 'Content-Range': `0-0/${total}` }))
    }

    if (route === 'POST /rest/v1/signup_attempts') {
      attempts.push({
        ip_hash: String(body['ip_hash']),
        email_hash: String(body['email_hash']),
        outcome: String(body['outcome']),
        at: clock,
      })
      return Promise.resolve(reply(201, null))
    }

    if (route === 'DELETE /rest/v1/signup_attempts') {
      if (faults.purge) return Promise.resolve(reply(500, {}))
      const before = new Date((url.searchParams.get('at') ?? '').replace(/^lt\./, ''))
      for (let index = attempts.length - 1; index >= 0; index -= 1) {
        if ((attempts[index]?.at ?? clock) < before) attempts.splice(index, 1)
      }
      return Promise.resolve(reply(204, null))
    }

    return Promise.resolve(reply(404, { message: `rota desconhecida no teste: ${route}` }))
  }

  // O Auth recebe pedidos de reenvio com a chave pública, não a de serviço.
  const fetchRouter: typeof fetch = (input, init) => {
    const url = urlOf(input)
    if (url.pathname === '/auth/v1/resend') {
      calls.push('POST /auth/v1/resend')
      return Promise.resolve(reply(200, {}))
    }
    return fetchFake(input, init)
  }

  const deps: Deps = {
    env: { supabaseUrl: 'http://supabase.test', anonKey: ANON_KEY, serviceKey: SERVICE_KEY },
    fetch: fetchRouter,
    now: () => clock,
  }

  return {
    deps,
    users,
    profiles,
    settings,
    attempts,
    calls,
    faults,
    addUser,
    setClock(next: Date) {
      clock = next
    },
    advance(ms: number) {
      clock = new Date(clock.getTime() + ms)
    },
  }
}

export function post(
  body: unknown,
  options: { token?: string; ip?: string; raw?: string } = {},
): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.token !== undefined) headers['Authorization'] = `Bearer ${options.token}`
  if (options.ip !== undefined) headers['x-forwarded-for'] = options.ip
  return new Request('http://functions.test/fn', {
    method: 'POST',
    headers,
    body: options.raw ?? JSON.stringify(body),
  })
}
