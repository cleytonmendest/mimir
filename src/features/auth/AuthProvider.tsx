import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { describeError } from '@/features/diagnostics/error-report'
import { clearDrafts } from '@/features/forms/useDraft'
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
const NO_PROFILE_MESSAGE = 'Não encontramos o seu perfil. Fale com o administrador dos mercados.'

function failure(error: unknown): AuthState {
  // Falta de configuração é erro de quem implantou o app: vale mostrar o texto real.
  return {
    status: 'failed',
    message: error instanceof ConfigError ? error.message : OFFLINE_MESSAGE,
    details: describeError(error),
  }
}

/**
 * Quem está logado vem só dos avisos do gateway (a sessão fica guardada no aparelho): entrar e
 * sair não mexem no estado diretamente, só pedem ao gateway e esperam o aviso.
 */
export function AuthProvider({ gateway, children }: { gateway: AuthGateway; children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    // undefined = ainda não sabemos quem é; evita recarregar o perfil quando o SDK repete o aviso
    // (ele avisa de novo a cada renovação do token).
    let current: string | null | undefined

    const apply = (userId: string | null) => {
      if (!active || userId === current) return
      current = userId

      if (userId === null) {
        setState({ status: 'signedOut' })
        return
      }
      setState({ status: 'loading' })
      gateway.loadProfile(userId).then(
        (profile) => {
          if (!active || current !== userId) return
          setState(
            profile === null
              ? { status: 'failed', message: NO_PROFILE_MESSAGE, details: null }
              : { status: 'signedIn', profile },
          )
        },
        (error: unknown) => {
          if (active && current === userId) setState(failure(error))
        },
      )
    }

    const unsubscribe = gateway.subscribe(apply)
    gateway.currentUserId().then(apply, (error: unknown) => {
      if (active) setState(failure(error))
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [gateway, attempt])

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
    clearDrafts()
    try {
      await gateway.signOut()
    } catch (error) {
      setState(failure(error))
    }
  }, [gateway])

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
