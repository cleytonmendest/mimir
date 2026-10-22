import { AuthFailure, type AuthGateway } from '@/lib/supabase/auth'
import { ConfigError } from '@/lib/supabase/errors'
import type { UserProfile } from '@/lib/supabase/mappers'

/** Apoio só para testes. Não importar em código de produção. */

export interface FakeAccount {
  userId: string
  password: string
  /** null = o usuário existe no login, mas o perfil não chegou a ser criado. */
  profile: UserProfile | null
}

export interface FakeSetup {
  /** Contas por e-mail. */
  accounts?: Record<string, FakeAccount>
  /** E-mail de quem já está logado neste aparelho. */
  signedInAs?: string
  /** Segura o login até esta promessa resolver (para ver o estado "entrando"). */
  holdSignIn?: Promise<void>
  /** Links de ativação válidos: token -> e-mail da conta. */
  activationTokens?: Record<string, string>
}

export type FakeFault = 'config' | 'offline' | null

/** Links de ativação do fake: token -> e-mail da conta. Cada token vale uma vez só. */
export interface FakeActivation {
  tokens: Record<string, string>
}

export const ana: FakeAccount = {
  userId: 'u-ana',
  password: 'segredo-da-ana',
  profile: { id: 'u-ana', role: 'supplier', fullName: 'Ana', active: true },
}

export const lia: FakeAccount = {
  userId: 'u-lia',
  password: 'segredo-da-lia',
  profile: { id: 'u-lia', role: 'admin', fullName: 'Lia', active: true },
}

/**
 * Imita o gateway de verdade: quem entra ou sai é avisado a quem assinou, de forma assíncrona,
 * como o SDK faz. `fault` simula servidor sem configuração ou aparelho sem internet.
 */
export function createFakeGateway(setup: FakeSetup = {}) {
  const accounts = setup.accounts ?? {}
  const listeners = new Set<(userId: string | null) => void>()
  let current: string | null =
    setup.signedInAs === undefined ? null : (accounts[setup.signedInAs]?.userId ?? null)
  let fault: FakeFault = null
  const activationTokens = { ...setup.activationTokens }

  function emit() {
    const userId = current
    for (const listener of listeners) queueMicrotask(() => listener(userId))
  }

  const gateway: AuthGateway = {
    currentUserId() {
      if (fault === 'config') return Promise.reject(new ConfigError('Defina VITE_SUPABASE_URL'))
      return Promise.resolve(current)
    },
    subscribe(listener) {
      if (fault === 'config') return () => undefined
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async signIn(email, password) {
      await setup.holdSignIn
      if (fault === 'config') throw new ConfigError('Defina VITE_SUPABASE_URL')
      if (fault === 'offline') throw new AuthFailure('NETWORK', 'Sem conexão')
      const account = accounts[email]
      if (account?.password !== password) {
        throw new AuthFailure('INVALID_CREDENTIALS', 'E-mail ou senha incorretos')
      }
      current = account.userId
      emit()
    },
    signOut() {
      current = null
      emit()
      return Promise.resolve()
    },
    loadProfile(userId) {
      if (fault === 'offline') return Promise.reject(new Error('sem rede'))
      const account = Object.values(accounts).find((candidate) => candidate.userId === userId)
      return Promise.resolve(account?.profile ?? null)
    },
    redeemActivationToken(tokenHash) {
      if (fault === 'offline') return Promise.reject(new AuthFailure('NETWORK', 'Sem conexão'))
      const email = activationTokens[tokenHash]
      const account = email === undefined ? undefined : accounts[email]
      if (account === undefined) return Promise.resolve('INVALID_LINK')
      delete activationTokens[tokenHash]
      current = account.userId
      emit()
      return Promise.resolve('OK')
    },
    setPassword(password) {
      if (fault === 'offline') return Promise.reject(new AuthFailure('NETWORK', 'Sem conexão'))
      const account = Object.values(accounts).find((candidate) => candidate.userId === current)
      if (account === undefined) return Promise.reject(new AuthFailure('UNKNOWN', 'Sem sessão'))
      if (password.length < 10) {
        return Promise.reject(new AuthFailure('WEAK_PASSWORD', 'Essa senha não serve'))
      }
      account.password = password
      return Promise.resolve()
    },
  }

  return {
    ...gateway,
    setFault(next: FakeFault) {
      fault = next
    },
  }
}
