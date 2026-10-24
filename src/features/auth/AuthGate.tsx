import type { ReactNode } from 'react'
import { Button } from '@/design-system/components/ui/button'
import { FailureNotice } from '@/features/diagnostics/FailureNotice'
import type { UserProfile } from '@/lib/supabase/mappers'
import { useAuth } from './auth-context'
import { AuthLayout } from './AuthLayout'
import { LoginForm } from './LoginForm'

/** Só deixa passar quem está logado; para os demais mostra o que fazer. */
export function AuthGate({ children }: { children: (profile: UserProfile) => ReactNode }) {
  const { state, signOut, retry } = useAuth()

  switch (state.status) {
    case 'loading':
      return (
        <AuthLayout>
          <p role="status" className="text-muted-foreground">
            Carregando…
          </p>
        </AuthLayout>
      )
    case 'signedOut':
      return (
        <AuthLayout>
          <LoginForm />
        </AuthLayout>
      )
    case 'failed':
      return (
        <AuthLayout>
          <FailureNotice
            className="grid gap-4"
            message={state.message}
            details={state.details}
            onRetry={retry}
          >
            <Button
              variant="outline"
              onClick={() => {
                void signOut()
              }}
            >
              Sair
            </Button>
          </FailureNotice>
        </AuthLayout>
      )
    case 'signedIn':
      if (!state.profile.active) {
        return (
          <AuthLayout>
            <div className="grid gap-4">
              <p role="alert">
                Sua conta foi desativada. Fale com o administrador dos mercados para voltar a usar o
                app.
              </p>
              <div>
                <Button
                  onClick={() => {
                    void signOut()
                  }}
                >
                  Sair
                </Button>
              </div>
            </div>
          </AuthLayout>
        )
      }
      return <>{children(state.profile)}</>
  }
}
