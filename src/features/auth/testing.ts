import type { Identity } from '@/lib/offline/store'
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
  /** Segura a resposta "quem está logado?" (o SDK demora assim sem rede e com o token vencido). */
  holdSession?: Promise<void>
}

/** `session`: o SDK falha ao ler a sessão (sem rede). */
export type FakeFault = 'config' | 'offline' | 'session' | null

export const ana: FakeAccount = {
  userId: 'u-ana',
  password: 'segredo-da-ana',
  profile: { id: 'u-ana', role: 'repositor', fullName: 'Ana' },
}

export const lia: FakeAccount = {
  userId: 'u-lia',
  password: 'segredo-da-lia',
  profile: { id: 'u-lia', role: 'leader', fullName: 'Lia' },
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

  function emit() {
    const userId = current
    for (const listener of listeners) queueMicrotask(() => listener(userId))
  }

  const gateway: AuthGateway = {
    async currentUserId() {
      await setup.holdSession
      if (fault === 'config') throw new ConfigError('Defina VITE_SUPABASE_URL')
      if (fault === 'session') throw new Error('sem rede')
      return current
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
  }

  return {
    ...gateway,
    setFault(next: FakeFault) {
      fault = next
    },
    /** O SDK avisa de novo do mesmo usuário (token renovado, sinal de volta). */
    emitAgain() {
      emit()
    },
    /** A sessão some por fora (token revogado): o SDK avisa que ninguém está logado. */
    expireSession() {
      current = null
      emit()
    },
  }
}

/** O armazenamento do aparelho em memória, para os testes da tela. */
export function createFakeIdentityStore(initial: Identity | null = null) {
  let saved = initial
  const calls = { saved: 0, cleared: 0 }
  return {
    identity: () => Promise.resolve(saved),
    saveIdentity: (identity: Identity) => {
      saved = identity
      calls.saved += 1
      return Promise.resolve()
    },
    clearIdentity: () => {
      saved = null
      calls.cleared += 1
      return Promise.resolve()
    },
    current: () => saved,
    calls,
  }
}
