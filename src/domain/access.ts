/**
 * Cadastro e acesso de fornecedores. As regras daqui são repetidas, de propósito, em
 * supabase/functions/_shared/validate.ts (as Edge Functions não importam de src/); o teste
 * scripts/access-parity.test.ts garante que as duas versões decidem igual.
 */

/** Como a página pública /cadastro funciona. Espelha o enum signup_mode do banco. */
export const SIGNUP_MODES = ['closed', 'invite', 'open'] as const
export type SignupMode = (typeof SIGNUP_MODES)[number]

export const MIN_PASSWORD_LENGTH = 10
/** O bcrypt do Supabase Auth ignora o que passa de 72 bytes: melhor recusar a enganar. */
export const MAX_PASSWORD_LENGTH = 72
export const MAX_SUPPLIER_NAME_LENGTH = 120
export const MAX_EMAIL_LENGTH = 254

/** Sem 0, O, 1 e I: nada que se confunda ao ditar por telefone. Espelha o banco. */
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

/** Conferência barata para poupar a ida ao servidor; quem decide se o e-mail existe é o login. */
export function isPlausibleEmail(email: string): boolean {
  return email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export interface SupplierInput {
  email: string
  fullName: string
}

export type SupplierValidation = { ok: true; value: SupplierInput } | { ok: false; message: string }

/** O nome ou a empresa do fornecedor. */
export function validateSupplierName(raw: string): string | null {
  const fullName = raw.trim()
  if (fullName === '') return 'Informe o nome do fornecedor.'
  if (fullName.length > MAX_SUPPLIER_NAME_LENGTH) {
    return `O nome pode ter até ${MAX_SUPPLIER_NAME_LENGTH} caracteres.`
  }
  return null
}

/** O e-mail, do jeito que se digita (maiúsculas e espaços nas pontas não contam). */
export function validateEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  if (email === '') return 'Informe o e-mail.'
  if (!isPlausibleEmail(email)) return 'Esse e-mail não parece certo. Confira e tente de novo.'
  return null
}

/** Na entrada só se confere que há senha: quem diz se está certa é o servidor. */
export function validateLoginPassword(password: string): string | null {
  return password === '' ? 'Informe a senha.' : null
}

/** No cadastro por convite o código é obrigatório; se está certo, quem diz é o servidor. */
export function validateInviteCodeEntry(code: string): string | null {
  return code.trim() === '' ? 'Informe o código de convite.' : null
}

/**
 * Confere o que se digitou ao cadastrar um fornecedor. O e-mail sai em minúsculas e sem espaços.
 * Cada campo tem a sua conferência (acima), que as telas usam ao sair do campo.
 */
export function validateSupplierInput(raw: SupplierInput): SupplierValidation {
  const problem = validateSupplierName(raw.fullName) ?? validateEmail(raw.email)
  if (problem !== null) return { ok: false, message: problem }
  return {
    ok: true,
    value: { email: raw.email.trim().toLowerCase(), fullName: raw.fullName.trim() },
  }
}

/**
 * Do jeito que alguém digita ou cola ("k7qd 4max", "K7QD-4MXA ") para o que o banco guarda
 * (maiúsculas, sem hífen nem espaço).
 */
export function normalizeInviteCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export function isInviteCode(code: string): boolean {
  return (
    code.length === INVITE_CODE_LENGTH &&
    [...code].every((character) => INVITE_CODE_ALPHABET.includes(character))
  )
}

/** "K7QD4MXA" -> "K7QD-4MXA", para ler e ditar. */
export function formatInviteCode(code: string): string {
  const half = INVITE_CODE_LENGTH / 2
  return code.length === INVITE_CODE_LENGTH ? `${code.slice(0, half)}-${code.slice(half)}` : code
}
