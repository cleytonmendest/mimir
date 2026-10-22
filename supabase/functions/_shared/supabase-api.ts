import type { Deps } from './deps.ts'
import { UpstreamError } from './http.ts'

/**
 * As chamadas ao Auth (GoTrue) e ao PostgREST que as funções precisam. Sem SDK de propósito: só
 * fetch, então não há pacote externo para baixar, auditar ou quebrar, e tudo é fácil de testar.
 */

interface Reply {
  status: number
  body: unknown
  headers: Headers
}

async function request(deps: Deps, path: string, init: RequestInit): Promise<Reply> {
  let response: Response
  try {
    response = await deps.fetch(`${deps.env.supabaseUrl}${path}`, init)
  } catch (cause) {
    throw new UpstreamError(`Falha de rede em ${path}`, { cause })
  }
  const raw = await response.text()
  let body: unknown = null
  if (raw !== '') {
    try {
      body = JSON.parse(raw)
    } catch {
      body = raw
    }
  }
  return { status: response.status, body, headers: response.headers }
}

function unexpected(path: string, reply: Reply): UpstreamError {
  return new UpstreamError(`${path} respondeu ${reply.status}: ${JSON.stringify(reply.body)}`)
}

function serviceHeaders(deps: Deps): Record<string, string> {
  return {
    apikey: deps.env.serviceKey,
    Authorization: `Bearer ${deps.env.serviceKey}`,
    'Content-Type': 'application/json',
  }
}

function field(body: unknown, name: string): unknown {
  return typeof body === 'object' && body !== null
    ? (body as Record<string, unknown>)[name]
    : undefined
}

// ---------------------------------------------------------------- quem chama

/** Quem é o dono do token, ou null se o token não vale (ausente, vencido, ou só a chave pública). */
export async function getCaller(deps: Deps, token: string): Promise<{ id: string } | null> {
  const path = '/auth/v1/user'
  const reply = await request(deps, path, {
    headers: { apikey: deps.env.anonKey, Authorization: `Bearer ${token}` },
  })
  if (reply.status === 401 || reply.status === 403) return null
  const id = field(reply.body, 'id')
  if (reply.status !== 200 || typeof id !== 'string') throw unexpected(path, reply)
  return { id }
}

/** O próprio banco diz se quem chama é administrador ativo (is_admin lê o token, não o corpo). */
export async function callerIsAdmin(deps: Deps, token: string): Promise<boolean> {
  const path = '/rest/v1/rpc/is_admin'
  const reply = await request(deps, path, {
    method: 'POST',
    headers: {
      apikey: deps.env.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  })
  if (reply.status === 401 || reply.status === 403) return false
  if (reply.status !== 200 || typeof reply.body !== 'boolean') throw unexpected(path, reply)
  return reply.body
}

// ---------------------------------------------------------------- contas (Auth)

export type CreateUserResult =
  { ok: true; id: string } | { ok: false; reason: 'EMAIL_EXISTS' | 'WEAK_PASSWORD' }

export async function createAuthUser(
  deps: Deps,
  input: { email: string; fullName: string; password?: string; confirmed: boolean },
): Promise<CreateUserResult> {
  const path = '/auth/v1/admin/users'
  const reply = await request(deps, path, {
    method: 'POST',
    headers: serviceHeaders(deps),
    body: JSON.stringify({
      email: input.email,
      ...(input.password === undefined ? {} : { password: input.password }),
      email_confirm: input.confirmed,
      user_metadata: { full_name: input.fullName },
    }),
  })
  const id = field(reply.body, 'id')
  if ((reply.status === 200 || reply.status === 201) && typeof id === 'string') {
    return { ok: true, id }
  }
  const code = field(reply.body, 'error_code')
  if (reply.status === 422 && (code === 'email_exists' || code === 'user_already_exists')) {
    return { ok: false, reason: 'EMAIL_EXISTS' }
  }
  if (reply.status === 422 && code === 'weak_password') {
    return { ok: false, reason: 'WEAK_PASSWORD' }
  }
  throw unexpected(path, reply)
}

/**
 * O token do link de ativação ("defina sua senha"). Não manda e-mail nenhum: quem entrega o link
 * é o administrador. Vale pelo tempo de otp_expiry (24 h) e uma vez só.
 */
export async function generateRecoveryToken(deps: Deps, email: string): Promise<string> {
  const path = '/auth/v1/admin/generate_link'
  const reply = await request(deps, path, {
    method: 'POST',
    headers: serviceHeaders(deps),
    body: JSON.stringify({ type: 'recovery', email }),
  })
  const token = field(reply.body, 'hashed_token')
  if (reply.status !== 200 || typeof token !== 'string') throw unexpected(path, reply)
  return token
}

/** Desfaz uma conta criada pela metade. Falha em silêncio: já estamos tratando outro erro. */
export async function deleteAuthUser(deps: Deps, id: string): Promise<void> {
  try {
    await request(deps, `/auth/v1/admin/users/${id}`, {
      method: 'DELETE',
      headers: serviceHeaders(deps),
    })
  } catch (error) {
    console.error(error)
  }
}

/** Pede o e-mail de confirmação (só o modo livre usa). Sem SMTP configurado, falha: tudo bem. */
export async function resendSignupConfirmation(deps: Deps, email: string): Promise<void> {
  try {
    await request(deps, '/auth/v1/resend', {
      method: 'POST',
      headers: { apikey: deps.env.anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'signup', email }),
    })
  } catch (error) {
    console.error(error)
  }
}

// ---------------------------------------------------------------- dados (PostgREST, chave de serviço)

export interface ProfileRow {
  id: string
  role: 'admin' | 'supplier'
  email: string | null
  full_name: string
  deactivated_at: string | null
}

export async function getProfile(deps: Deps, id: string): Promise<ProfileRow | null> {
  const path = `/rest/v1/profiles?id=eq.${id}&select=id,role,email,full_name,deactivated_at`
  const reply = await request(deps, path, { headers: serviceHeaders(deps) })
  if (reply.status !== 200 || !Array.isArray(reply.body)) throw unexpected(path, reply)
  const row: unknown = reply.body[0]
  return row === undefined ? null : (row as ProfileRow)
}

/** Só para o script do primeiro administrador: acha o perfil pelo e-mail do login. */
export async function getProfileByEmail(deps: Deps, email: string): Promise<ProfileRow | null> {
  const path = `/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,role,email,full_name,deactivated_at`
  const reply = await request(deps, path, { headers: serviceHeaders(deps) })
  if (reply.status !== 200 || !Array.isArray(reply.body)) throw unexpected(path, reply)
  const row: unknown = reply.body[0]
  return row === undefined ? null : (row as ProfileRow)
}

/** Só para o script do primeiro administrador: o papel nunca muda por outro caminho a partir do app. */
export async function setProfileRole(
  deps: Deps,
  id: string,
  role: 'admin' | 'supplier',
): Promise<void> {
  const path = `/rest/v1/profiles?id=eq.${id}`
  const reply = await request(deps, path, {
    method: 'PATCH',
    headers: { ...serviceHeaders(deps), Prefer: 'return=minimal' },
    body: JSON.stringify({ role }),
  })
  if (reply.status !== 204) throw unexpected(path, reply)
}

export interface SignupSettings {
  mode: 'closed' | 'invite' | 'open'
  inviteCode: string | null
}

export async function getSignupSettings(deps: Deps): Promise<SignupSettings> {
  const path = '/rest/v1/signup_settings?select=mode,invite_code&limit=1'
  const reply = await request(deps, path, { headers: serviceHeaders(deps) })
  const row: unknown = Array.isArray(reply.body) ? reply.body[0] : undefined
  const mode = field(row, 'mode')
  if (reply.status !== 200 || (mode !== 'closed' && mode !== 'invite' && mode !== 'open')) {
    throw unexpected(path, reply)
  }
  const code = field(row, 'invite_code')
  return { mode, inviteCode: typeof code === 'string' ? code : null }
}

export async function countSignupAttempts(
  deps: Deps,
  column: 'ip_hash' | 'email_hash',
  hash: string,
  since: Date,
): Promise<number> {
  const path = `/rest/v1/signup_attempts?${column}=eq.${hash}&at=gte.${encodeURIComponent(since.toISOString())}&select=id`
  const reply = await request(deps, path, {
    headers: { ...serviceHeaders(deps), Prefer: 'count=exact', Range: '0-0' },
  })
  // O total vem em "Content-Range: 0-0/17" (ou "*/0").
  const total = Number(reply.headers.get('content-range')?.split('/')[1])
  if ((reply.status !== 200 && reply.status !== 206) || !Number.isInteger(total)) {
    throw unexpected(path, reply)
  }
  return total
}

export async function recordSignupAttempt(
  deps: Deps,
  attempt: { ipHash: string; emailHash: string; outcome: string },
): Promise<void> {
  const path = '/rest/v1/signup_attempts'
  const reply = await request(deps, path, {
    method: 'POST',
    headers: { ...serviceHeaders(deps), Prefer: 'return=minimal' },
    body: JSON.stringify({
      ip_hash: attempt.ipHash,
      email_hash: attempt.emailHash,
      outcome: attempt.outcome,
    }),
  })
  if (reply.status !== 201) throw unexpected(path, reply)
}

/** Apaga tentativas antigas: o limite só olha a última hora. */
export async function purgeSignupAttempts(deps: Deps, before: Date): Promise<void> {
  const path = `/rest/v1/signup_attempts?at=lt.${encodeURIComponent(before.toISOString())}`
  const reply = await request(deps, path, {
    method: 'DELETE',
    headers: { ...serviceHeaders(deps), Prefer: 'return=minimal' },
  })
  if (reply.status !== 204) throw unexpected(path, reply)
}
