import { normalizeInviteCode } from '@/domain/access'
import type { AccessGateway, SignUpInput, SignUpResult } from '@/lib/supabase/access-gateway'
import { RequestFailure, type RequestFailureCode } from '@/lib/supabase/errors'
import type { SignupSettings, Supplier } from '@/lib/supabase/mappers'

/** Apoio só para testes. Não importar em código de produção. */

export interface FakeAccessSetup {
  suppliers?: Supplier[]
  settings?: SignupSettings
  /** Reservas futuras de cada fornecedor (o que a desativação cancela). */
  futureBookings?: Record<string, number>
}

/**
 * O servidor de acesso em memória, com as mesmas regras das Edge Functions e do banco (modo do
 * cadastro, código, e-mail repetido, desativar cancela reservas). `fail` simula falha de rede ou
 * servidor; `signUps` guarda o que a página pública enviou.
 */
export function createFakeAccessGateway(setup: FakeAccessSetup = {}) {
  const suppliers = (setup.suppliers ?? []).map((entry) => ({ ...entry }))
  const settings: SignupSettings = setup.settings ?? { mode: 'closed', inviteCode: null }
  const futureBookings = { ...setup.futureBookings }
  const state = {
    fail: null as RequestFailureCode | null,
    calls: [] as string[],
    signUps: [] as SignUpInput[],
    nextId: 1,
    /** O que o próximo cadastro público responde, em vez da regra normal. */
    signUpOutcome: null as
      null | 'RATE_LIMITED' | 'WEAK_PASSWORD' | 'SIGNUP_CLOSED' | 'INVALID_INPUT' | 'UNRECOGNIZED',
    inviteCounter: 0,
  }

  /** Como o gateway de verdade, nunca lança direto: a falha vem como promessa rejeitada. */
  function run<T>(call: string, body: () => T): Promise<T> {
    return new Promise((resolve) => {
      state.calls.push(call)
      if (state.fail !== null) throw new RequestFailure(state.fail, `falha simulada: ${state.fail}`)
      resolve(body())
    })
  }

  // Sempre 8 caracteres do alfabeto real do convite; o primeiro gerado termina em B.
  const SUFFIXES = 'BCDEFGHJKLMNPQRSTUVWXYZ'
  const newCode = (): string => `K7QD4MX${SUFFIXES.charAt(state.inviteCounter++ % SUFFIXES.length)}`

  const gateway: AccessGateway = {
    listSuppliers: () =>
      run('listSuppliers', () =>
        suppliers
          .map((entry) => ({ ...entry }))
          .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      ),

    createSupplier: (input) =>
      run('createSupplier', () => {
        if (suppliers.some((entry) => entry.email === input.email)) {
          return {
            ok: false,
            code: 'EMAIL_EXISTS',
            message: 'Já existe uma conta com esse e-mail.',
          } as const
        }
        const supplier: Supplier = {
          id: `u-new-${state.nextId++}`,
          fullName: input.fullName,
          email: input.email,
          active: true,
        }
        suppliers.push(supplier)
        return { ok: true, supplier: { ...supplier }, token: `token-${supplier.id}` } as const
      }),

    supplierLink: (supplierId) =>
      run('supplierLink', () => {
        const found = suppliers.find((entry) => entry.id === supplierId)
        if (found === undefined) return { ok: false, code: 'NOT_FOUND' } as const
        if (!found.active) return { ok: false, code: 'DEACTIVATED' } as const
        return { ok: true, token: `token-${found.id}-novo` } as const
      }),

    setSupplierActive: (supplierId, active) =>
      run('setSupplierActive', () => {
        const found = suppliers.find((entry) => entry.id === supplierId)
        if (found === undefined) return { ok: false, code: 'NOT_FOUND' } as const
        found.active = active
        const cancelled = active ? 0 : (futureBookings[supplierId] ?? 0)
        if (!active) futureBookings[supplierId] = 0
        return { ok: true, active, cancelled } as const
      }),

    signupSettings: () => run('signupSettings', () => ({ ...settings })),

    setSignupMode: (mode) =>
      run('setSignupMode', () => {
        settings.mode = mode
        if (mode === 'invite' && settings.inviteCode === null) settings.inviteCode = newCode()
        return { ok: true, settings: { ...settings } } as const
      }),

    regenerateInviteCode: () =>
      run('regenerateInviteCode', () => {
        settings.inviteCode = newCode()
        return { ok: true, settings: { ...settings } } as const
      }),

    signupStatus: () => run('signupStatus', () => settings.mode),

    signUp: (input) =>
      run('signUp', (): SignUpResult => {
        state.signUps.push(input)
        if (state.signUpOutcome !== null) {
          return { ok: false, code: state.signUpOutcome, message: null }
        }
        if (settings.mode === 'closed') return { ok: false, code: 'SIGNUP_CLOSED', message: null }
        if (
          settings.mode === 'invite' &&
          (settings.inviteCode === null ||
            normalizeInviteCode(input.code ?? '') !== settings.inviteCode)
        ) {
          return { ok: false, code: 'INVALID_CODE', message: null }
        }
        if (suppliers.some((entry) => entry.email === input.email)) {
          return settings.mode === 'invite'
            ? { ok: false, code: 'EMAIL_EXISTS', message: null }
            : { ok: true, status: 'CONFIRM_EMAIL' }
        }
        suppliers.push({
          id: `u-signup-${state.nextId++}`,
          fullName: input.fullName,
          email: input.email,
          active: true,
        })
        return { ok: true, status: settings.mode === 'invite' ? 'CREATED' : 'CONFIRM_EMAIL' }
      }),
  }

  return { gateway, state, suppliers, settings }
}

export const supplier = (id: string, fullName: string, active = true): Supplier => ({
  id,
  fullName,
  email: `${id}@loja.com`,
  active,
})
