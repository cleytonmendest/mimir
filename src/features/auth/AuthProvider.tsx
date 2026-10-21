import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { DeviceStore, Identity } from '@/lib/offline/store'
import { AuthFailure, type AuthGateway } from '@/lib/supabase/auth'
import { ConfigError } from '@/lib/supabase/errors'
import {
  AuthContext,
  type AuthContextValue,
  type AuthState,
  type SignInResult,
} from './auth-context'

const OFFLINE_MESSAGE =
  'Não foi possível conectar ao servidor. Verifique a internet e tente de novo.'
const NO_PROFILE_MESSAGE = 'Não encontramos o seu perfil. Fale com o líder da sua equipe.'

/** Só o que o AuthProvider usa do armazenamento do aparelho. */
export type IdentityStore = Pick<DeviceStore, 'identity' | 'saveIdentity' | 'clearIdentity'>

function failure(error: unknown): AuthState {
  // Falta de configuração é erro de quem implantou o app: vale mostrar o texto real.
  return {
    status: 'failed',
    message: error instanceof ConfigError ? error.message : OFFLINE_MESSAGE,
  }
}

const SLOW = Symbol('slow')

/** Um prazo que dá para cancelar (não deixa timer pendurado quando o app é desmontado). */
function deadline(ms: number): { promise: Promise<typeof SLOW>; cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined
  const promise = new Promise<typeof SLOW>((resolve) => {
    handle = setTimeout(() => {
      resolve(SLOW)
    }, ms)
  })
  return { promise, cancel: () => clearTimeout(handle) }
}

/** A busca do perfil também tem prazo: rede que "pendura" não prende a abertura do app. */
async function within<T>(work: Promise<T>, ms: number): Promise<T> {
  const limit = deadline(ms)
  try {
    const winner = await Promise.race([work, limit.promise])
    if (winner === SLOW)
      throw new AuthFailure('NETWORK', 'O servidor demorou demais para responder')
    return winner
  } finally {
    limit.cancel()
  }
}

type SessionAnswer = { id: string | null } | { error: unknown }

/**
 * Quem está logado vem só dos avisos do gateway (a sessão fica guardada no aparelho): entrar e
 * sair não mexem no estado diretamente, só pedem ao gateway e esperam o aviso.
 *
 * Sem rede o app ainda abre: a última identidade confirmada fica guardada no aparelho (`device`) e
 * vale enquanto o servidor não puder ser consultado (estado `offline`). Ela NÃO substitui a sessão:
 * quando o servidor responde, ou confirma (volta a `signedIn`) ou diz que não há sessão (`signedOut`).
 * Pelo estudo da sessão do SDK (ADR 0001), com o token vencido e sem rede o SDK demora ~25 s para
 * falhar, e numa rede que "pendura" nunca responde: por isso os prazos abaixo.
 */
export function AuthProvider({
  gateway,
  device,
  sessionTimeoutMs = 4_000,
  profileTimeoutMs = 8_000,
  children,
}: {
  gateway: AuthGateway
  device?: IdentityStore
  /** Quanto esperar o SDK dizer quem está logado antes de abrir com a identidade guardada. */
  sessionTimeoutMs?: number
  profileTimeoutMs?: number
  children: ReactNode
}) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    // undefined = ainda não sabemos quem é; evita recarregar o perfil quando o SDK repete o aviso
    // (ele avisa de novo a cada renovação do token).
    let current: string | null | undefined
    let offline = false

    // Nunca rejeita: sem armazenamento, o app só deixa de abrir sem rede.
    const stored: Promise<Identity | null> = (device?.identity() ?? Promise.resolve(null)).catch(
      () => null,
    )

    const showOffline = (identity: Identity) => {
      offline = true
      setState({ status: 'offline', profile: identity.profile })
    }

    const verify = async (userId: string) => {
      try {
        const profile = await within(gateway.loadProfile(userId), profileTimeoutMs)
        if (!active || current !== userId) return
        if (profile === null) {
          offline = false
          setState({ status: 'failed', message: NO_PROFILE_MESSAGE })
          return
        }
        void device?.saveIdentity({ profile, savedAt: new Date().toISOString() }).catch(() => {
          // não guardar a identidade só tira a abertura sem rede; o app segue
        })
        offline = false
        setState({ status: 'signedIn', profile })
      } catch (error) {
        if (!active || current !== userId) return
        const identity = await stored
        if (!active || current !== userId) return
        if (identity?.profile.id === userId && !(error instanceof ConfigError)) {
          showOffline(identity)
        } else {
          offline = false
          setState(failure(error))
        }
      }
    }

    const apply = (userId: string | null) => {
      // Em `offline`, repetir o mesmo usuário (token renovado, sinal de volta) é a chance de confirmar.
      if (!active || (userId === current && !(offline && userId !== null))) return
      const wasOffline = offline
      current = userId

      if (userId === null) {
        offline = false
        void device?.clearIdentity().catch(() => undefined)
        setState({ status: 'signedOut' })
        return
      }
      if (!wasOffline) setState({ status: 'loading' })
      void verify(userId)
    }

    const unsubscribe = gateway.subscribe(apply)

    const answer: Promise<SessionAnswer> = gateway.currentUserId().then(
      (id) => ({ id }),
      (error: unknown) => ({ error }),
    )
    const slow = deadline(sessionTimeoutMs)

    void (async () => {
      const first = await Promise.race([answer, slow.promise])
      if (!active) return
      if (first === SLOW) {
        // O SDK está demorando: abre com a identidade guardada, e a resposta tardia confirma ou desfaz.
        const identity = await stored
        if (active && current === undefined && identity !== null) showOffline(identity)
      }
      const result = first === SLOW ? await answer : first
      slow.cancel()
      if (!active) return

      if ('error' in result) {
        const identity = await stored
        if (!active || current !== undefined) return // um aviso do SDK já decidiu
        if (identity !== null && !(result.error instanceof ConfigError)) showOffline(identity)
        else setState(failure(result.error))
        return
      }
      apply(result.id)
    })()

    return () => {
      active = false
      slow.cancel()
      unsubscribe()
    }
  }, [gateway, device, sessionTimeoutMs, profileTimeoutMs, attempt])

  const signIn = useCallback(
    async (email: string, password: string): Promise<SignInResult> => {
      try {
        await gateway.signIn(email, password)
        return { ok: true }
      } catch (error) {
        return { ok: false, code: error instanceof AuthFailure ? error.code : 'UNKNOWN' }
      }
    },
    [gateway],
  )

  const signOut = useCallback(async () => {
    try {
      await gateway.signOut()
      // Quem saiu não abre mais o app sem rede. A fila de envio dele continua guardada no aparelho.
      await device?.clearIdentity().catch(() => undefined)
    } catch (error) {
      setState(failure(error))
    }
  }, [gateway, device])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((count) => count + 1)
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ state, signIn, signOut, retry }),
    [state, signIn, signOut, retry],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
