/**
 * As mesmas regras de src/domain/access.ts. As funções não importam de src/ (o deploy leva só a
 * pasta supabase/functions), então a cópia é deliberada; scripts/access-parity.test.ts garante que
 * as duas decidem igual.
 */
export const MIN_PASSWORD_LENGTH = 10
export const MAX_PASSWORD_LENGTH = 72
export const MAX_SUPPLIER_NAME_LENGTH = 120
export const MAX_EMAIL_LENGTH = 254
export const INVITE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const INVITE_CODE_LENGTH = 8

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A senha precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`
  }
  if (new TextEncoder().encode(password).length > MAX_PASSWORD_LENGTH) {
    return `A senha pode ter até ${MAX_PASSWORD_LENGTH} caracteres.`
  }
  return null
}

export function isPlausibleEmail(email: string): boolean {
  return email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export type NameEmailValidation =
  { ok: true; value: { email: string; fullName: string } } | { ok: false; message: string }

export function validateNameAndEmail(raw: {
  email: string
  fullName: string
}): NameEmailValidation {
  const fullName = raw.fullName.trim()
  const email = raw.email.trim().toLowerCase()
  if (fullName === '') return { ok: false, message: 'Informe o nome do fornecedor.' }
  if (fullName.length > MAX_SUPPLIER_NAME_LENGTH) {
    return { ok: false, message: `O nome pode ter até ${MAX_SUPPLIER_NAME_LENGTH} caracteres.` }
  }
  if (email === '') return { ok: false, message: 'Informe o e-mail.' }
  if (!isPlausibleEmail(email)) {
    return { ok: false, message: 'Esse e-mail não parece certo. Confira e tente de novo.' }
  }
  return { ok: true, value: { email, fullName } }
}

export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

/**
 * Compara em tempo constante em relação ao conteúdo: compara os hashes SHA-256 byte a byte, sem
 * parar no primeiro byte diferente. Quem chuta o código não ganha pista pelo tempo da resposta.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder()
  const [x, y] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ])
  const left = new Uint8Array(x)
  const right = new Uint8Array(y)
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }
  return difference === 0
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
