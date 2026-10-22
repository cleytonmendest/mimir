import { isAuthRetryableFetchError } from '@supabase/supabase-js'
import { getSupabase, type AppSupabaseClient } from './client'
import { ConfigError } from './errors'
import type { UserProfile } from './mappers'
import { getProfile } from './repository'

export type AuthFailureCode = 'INVALID_CREDENTIALS' | 'NETWORK' | 'WEAK_PASSWORD' | 'UNKNOWN'

/** O que acontece quando o fornecedor abre o link de ativação que o administrador enviou. */
export type ActivationResult = 'OK' | 'INVALID_LINK'

export class AuthFailure extends Error {
  readonly code: AuthFailureCode

  constructor(code: AuthFailureCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AuthFailure'
    this.code = code
  }
}

/**
 * O que as telas precisam saber de autenticação, sem tipo do SDK. O navegador nunca cria conta
 * (enable_signup = false no Supabase): as contas nascem nas Edge Functions, e o fornecedor só
 * define a própria senha, pelo link de ativação.
 */
export interface AuthGateway {
  /** Quem está logado neste aparelho (a sessão fica guardada nele), ou null. */
  currentUserId(): Promise<string | null>
  /** Avisa quando entra ou sai alguém. Devolve a função que cancela o aviso. */
  subscribe(listener: (userId: string | null) => void): () => void
  signIn(email: string, password: string): Promise<void>
  /** Sai deste aparelho (não nos outros do mesmo usuário). Funciona sem internet. */
  signOut(): Promise<void>
  loadProfile(userId: string): Promise<UserProfile | null>
  /**
   * Troca o token do link de ativação por uma sessão (vale uma vez só). Quem abre o link já fica
   * logado neste aparelho, e o passo seguinte é setPassword.
   */
  redeemActivationToken(tokenHash: string): Promise<ActivationResult>
  /** Define a senha de quem está logado (é o que fecha a ativação). */
  setPassword(password: string): Promise<void>
}

function toSignInFailure(error: { code?: string | undefined; message: string }): AuthFailure {
  if (error.code === 'invalid_credentials') {
    return new AuthFailure('INVALID_CREDENTIALS', 'E-mail ou senha incorretos', { cause: error })
  }
  if (isAuthRetryableFetchError(error)) {
    return new AuthFailure('NETWORK', 'Sem conexão com o servidor', { cause: error })
  }
  return new AuthFailure('UNKNOWN', `Falha ao entrar: ${error.message}`, { cause: error })
}

function toPasswordFailure(error: { code?: string | undefined; message: string }): AuthFailure {
  if (error.code === 'weak_password' || error.code === 'same_password') {
    return new AuthFailure('WEAK_PASSWORD', 'Essa senha não serve', { cause: error })
  }
  if (isAuthRetryableFetchError(error)) {
    return new AuthFailure('NETWORK', 'Sem conexão com o servidor', { cause: error })
  }
  return new AuthFailure('UNKNOWN', `Falha ao definir a senha: ${error.message}`, { cause: error })
}

/** O cliente só é pedido na hora de usar: sem .env o app abre e a falha aparece como erro de config. */
export function createAuthGateway(getClient: () => AppSupabaseClient = getSupabase): AuthGateway {
  return {
    async currentUserId() {
      const { data, error } = await getClient().auth.getSession()
      if (error !== null) {
        throw new AuthFailure('UNKNOWN', `Falha ao ler a sessão: ${error.message}`, {
          cause: error,
        })
      }
      return data.session?.user.id ?? null
    },

    subscribe(listener) {
      let client: AppSupabaseClient
      try {
        client = getClient()
      } catch (error) {
        if (error instanceof ConfigError) return () => undefined
        throw error
      }

      const { data } = client.auth.onAuthStateChange((_event, session) => {
        const userId = session?.user.id ?? null
        // Adiado de propósito: dentro deste callback o SDK segura um lock interno, e quem
        // chamasse o Supabase de novo aqui (ex.: carregar o perfil) ficaria preso nele.
        setTimeout(() => {
          listener(userId)
        }, 0)
      })
      return () => {
        data.subscription.unsubscribe()
      }
    },

    async signIn(email, password) {
      const { error } = await getClient().auth.signInWithPassword({ email, password })
      if (error !== null) throw toSignInFailure(error)
    },

    async signOut() {
      const client = getClient()
      // "local" revoga só esta sessão; o padrão ("global") derrubaria o login da mesma pessoa em
      // outros aparelhos.
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error === null) return

      // Sem internet o SDK não consegue avisar o servidor, mas apaga a sessão do aparelho do mesmo
      // jeito e devolve o erro de rede. Para quem saiu, o que vale é a sessão ter ido embora.
      const { data } = await client.auth.getSession()
      if (data.session !== null) {
        throw new AuthFailure('UNKNOWN', `Falha ao sair: ${error.message}`, { cause: error })
      }
    },

    loadProfile: (userId) => getProfile(getClient(), userId),

    async redeemActivationToken(tokenHash) {
      const { error } = await getClient().auth.verifyOtp({
        token_hash: tokenHash,
        type: 'recovery',
      })
      if (error === null) return 'OK'
      // Sem internet o link ainda pode estar bom: não dizer que venceu.
      if (isAuthRetryableFetchError(error)) {
        throw new AuthFailure('NETWORK', 'Sem conexão com o servidor', { cause: error })
      }
      return 'INVALID_LINK'
    },

    async setPassword(password) {
      const { error } = await getClient().auth.updateUser({ password })
      if (error !== null) throw toPasswordFailure(error)
    },
  }
}
