import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import type { SignupMode, SupplierInput } from '@/domain/access'
import {
  parseSetActiveResult,
  parseSettingsResult,
  parseSignupMode,
  record,
  text,
  type SetActiveResult,
  type SettingsResult,
} from './access-wire'
import { getSupabase, type AppSupabaseClient } from './client'
import { RequestFailure } from './errors'
import {
  signupSettingsFromRow,
  supplierFromRow,
  type SignupSettings,
  type Supplier,
} from './mappers'
import { toFailure } from './booking-gateway'

export type CreateSupplierResult =
  | { ok: true; supplier: Supplier; token: string }
  | { ok: false; code: 'EMAIL_EXISTS' | 'INVALID_INPUT'; message: string }

export type SupplierLinkResult =
  { ok: true; token: string } | { ok: false; code: 'DEACTIVATED' | 'NOT_FOUND' }

export interface SignUpInput {
  email: string
  fullName: string
  password: string
  /** Só no modo "com código". */
  code?: string
}

export type SignUpRefusal =
  | 'SIGNUP_CLOSED'
  | 'INVALID_CODE'
  | 'EMAIL_EXISTS'
  | 'WEAK_PASSWORD'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'

export type SignUpResult =
  /** CREATED: a conta já vale, dá para entrar. CONFIRM_EMAIL: falta confirmar pelo e-mail. */
  | { ok: true; status: 'CREATED' | 'CONFIRM_EMAIL' }
  | { ok: false; code: SignUpRefusal | 'UNRECOGNIZED'; message: string | null }

/**
 * Acesso e cadastro de fornecedores. As Edge Functions fazem o que precisa da chave de serviço
 * (criar conta, gerar link); o resto é RLS e funções do banco. Recusa de negócio volta como
 * resultado; falha de rede, sessão ou servidor vira RequestFailure.
 */
export interface AccessGateway {
  /** Só o administrador. */
  listSuppliers(): Promise<Supplier[]>
  createSupplier(input: SupplierInput): Promise<CreateSupplierResult>
  /** Novo token de ativação (o app monta o link). */
  supplierLink(supplierId: string): Promise<SupplierLinkResult>
  setSupplierActive(supplierId: string, active: boolean): Promise<SetActiveResult>
  signupSettings(): Promise<SignupSettings>
  setSignupMode(mode: SignupMode): Promise<SettingsResult>
  regenerateInviteCode(): Promise<SettingsResult>

  /** Páginas públicas: valem sem login. */
  signupStatus(): Promise<SignupMode>
  signUp(input: SignUpInput): Promise<SignUpResult>
}

interface FunctionReply {
  /** 0 = deu certo (2xx); senão o status HTTP da recusa. */
  status: number
  body: unknown
}

const SIGNUP_REFUSALS: readonly SignUpRefusal[] = [
  'SIGNUP_CLOSED',
  'INVALID_CODE',
  'EMAIL_EXISTS',
  'WEAK_PASSWORD',
  'RATE_LIMITED',
  'INVALID_INPUT',
]

export function createAccessGateway(
  getClient: () => AppSupabaseClient = getSupabase,
): AccessGateway {
  /** Chama uma Edge Function; recusas (4xx) voltam como resposta, o resto vira RequestFailure. */
  async function callFunction(name: string, body: Record<string, unknown>): Promise<FunctionReply> {
    const result = await getClient().functions.invoke<unknown>(name, { body })
    const error: unknown = result.error
    if (error === null) return { status: 0, body: result.data }

    if (error instanceof FunctionsFetchError) {
      throw new RequestFailure('NETWORK', 'Sem conexão com o servidor', { cause: error })
    }
    if (error instanceof FunctionsHttpError) {
      const response = error.context as Response
      const reply: unknown = await response.json().catch(() => null)
      if (response.status === 401 || response.status === 403) {
        // A função só responde assim para quem não é administrador (ou perdeu o login).
        const code =
          typeof reply === 'object' && reply !== null
            ? (reply as Record<string, unknown>)['error']
            : null
        if (code === 'UNAUTHENTICATED' || code === 'FORBIDDEN') {
          throw new RequestFailure('AUTH', 'A sessão não vale mais, ou você não pode fazer isso', {
            cause: error,
          })
        }
      }
      if (response.status >= 400 && response.status < 500) {
        return { status: response.status, body: reply }
      }
      throw new RequestFailure('SERVER', `O servidor não conseguiu atender (${response.status})`, {
        cause: error,
      })
    }
    // FunctionsRelayError (o gateway das funções não achou a função) e qualquer outro.
    throw new RequestFailure(
      error instanceof FunctionsRelayError ? 'SERVER' : 'INVALID_RESPONSE',
      'O servidor não conseguiu atender',
      { cause: error },
    )
  }

  function errorCode(reply: FunctionReply): string {
    const body = reply.body
    const code =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['error'] : null
    return typeof code === 'string' ? code : ''
  }

  function errorMessage(reply: FunctionReply): string | null {
    const body = reply.body
    const message =
      typeof body === 'object' && body !== null
        ? (body as Record<string, unknown>)['message']
        : null
    return typeof message === 'string' ? message : null
  }

  function unexpectedRefusal(name: string, reply: FunctionReply): RequestFailure {
    return new RequestFailure(
      'INVALID_RESPONSE',
      `Resposta inesperada de ${name} (${reply.status}): ${errorCode(reply)}`,
    )
  }

  return {
    async listSuppliers() {
      const { data, error, status } = await getClient()
        .from('profiles')
        .select('id, full_name, email, deactivated_at')
        .eq('role', 'supplier')
        .order('full_name')
      if (error !== null) throw toFailure(error, status)
      return data.map(supplierFromRow)
    },

    async createSupplier(input) {
      const reply = await callFunction('admin-create-supplier', { ...input })
      if (reply.status === 0) {
        const body = record(reply.body, 'admin-create-supplier')
        const supplier = record(body['supplier'], 'supplier')
        return {
          ok: true,
          token: text(body['token'], 'token'),
          supplier: {
            id: text(supplier['id'], 'id'),
            email: text(supplier['email'], 'email'),
            fullName: text(supplier['fullName'], 'fullName'),
            active: true,
          },
        }
      }
      const code = errorCode(reply)
      if (code === 'EMAIL_EXISTS' || code === 'INVALID_INPUT') {
        return { ok: false, code, message: errorMessage(reply) ?? '' }
      }
      throw unexpectedRefusal('admin-create-supplier', reply)
    },

    async supplierLink(supplierId) {
      const reply = await callFunction('admin-supplier-link', { supplierId })
      if (reply.status === 0) {
        return {
          ok: true,
          token: text(record(reply.body, 'admin-supplier-link')['token'], 'token'),
        }
      }
      const code = errorCode(reply)
      if (code === 'DEACTIVATED' || code === 'NOT_FOUND') return { ok: false, code }
      throw unexpectedRefusal('admin-supplier-link', reply)
    },

    async setSupplierActive(supplierId, active) {
      const { data, error, status } = await getClient().rpc('set_supplier_active_v1', {
        p_supplier: supplierId,
        p_active: active,
      })
      if (error !== null) throw toFailure(error, status)
      return parseSetActiveResult(data)
    },

    async signupSettings() {
      const { data, error, status } = await getClient()
        .from('signup_settings')
        .select('mode, invite_code')
        .single()
      if (error !== null) throw toFailure(error, status)
      return signupSettingsFromRow(data)
    },

    async setSignupMode(mode) {
      const { data, error, status } = await getClient().rpc('set_signup_mode_v1', { p_mode: mode })
      if (error !== null) throw toFailure(error, status)
      return parseSettingsResult(data)
    },

    async regenerateInviteCode() {
      const { data, error, status } = await getClient().rpc('regenerate_invite_code_v1')
      if (error !== null) throw toFailure(error, status)
      return parseSettingsResult(data)
    },

    async signupStatus() {
      const reply = await callFunction('signup-status', {})
      if (reply.status !== 0) throw unexpectedRefusal('signup-status', reply)
      return parseSignupMode(record(reply.body, 'signup-status')['mode'])
    },

    async signUp(input) {
      const reply = await callFunction('public-signup', { ...input })
      if (reply.status === 0) {
        const status = record(reply.body, 'public-signup')['status']
        if (status === 'CREATED' || status === 'CONFIRM_EMAIL') return { ok: true, status }
        throw new RequestFailure('INVALID_RESPONSE', 'Resposta inesperada de public-signup')
      }
      const code = errorCode(reply)
      return {
        ok: false,
        code: SIGNUP_REFUSALS.find((candidate) => candidate === code) ?? 'UNRECOGNIZED',
        message: errorMessage(reply),
      }
    },
  }
}
