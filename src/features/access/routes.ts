import { formatInviteCode, normalizeInviteCode } from '@/domain/access'

/** O app tem duas páginas públicas além da principal; o resto do endereço cai na principal. */
export const ACTIVATION_PATH = '/definir-senha'
export const SIGNUP_PATH = '/cadastro'

export type Route =
  | { page: 'home' }
  /** `token` é null quando o link veio cortado (sem o ?token=). */
  | { page: 'activation'; token: string | null }
  /** `code` é o convite que veio no link (?codigo=), já normalizado, ou '' se não veio. */
  | { page: 'signup'; code: string }

export function resolveRoute(location: { pathname: string; search: string }): Route {
  const path = location.pathname.replace(/\/+$/, '')
  const params = new URLSearchParams(location.search)
  if (path === ACTIVATION_PATH) {
    const token = params.get('token')
    return { page: 'activation', token: token === null || token === '' ? null : token }
  }
  if (path === SIGNUP_PATH) {
    return { page: 'signup', code: normalizeInviteCode(params.get('codigo') ?? '') }
  }
  return { page: 'home' }
}

/** O link que o administrador envia ao fornecedor para ele definir a senha. */
export function activationLink(origin: string, token: string): string {
  return `${origin}${ACTIVATION_PATH}?token=${encodeURIComponent(token)}`
}

/** O link de convite para a página de cadastro, com o código já preenchido. */
export function inviteLink(origin: string, code: string): string {
  return `${origin}${SIGNUP_PATH}?codigo=${encodeURIComponent(formatInviteCode(code))}`
}
