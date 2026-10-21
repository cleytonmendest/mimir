import type { ReactNode } from 'react'
import { Button } from '@/design-system/components/ui/button'
import type { UserProfile } from '@/lib/supabase/mappers'
import { useAuth } from './auth-context'
import { LoginForm } from './LoginForm'

/** Só deixa passar quem está logado; para os demais mostra o que fazer. */
export function AuthGate({
  children,
}: {
  /** `offline`: a identidade vem do aparelho porque o servidor não respondeu. */
  children: (profile: UserProfile, info: { offline: boolean }) => ReactNode
}) {
  const { state, signOut, retry } = useAuth()

  switch (state.status) {
    case 'loading':
      return (
        <p role="status" className="mt-6 text-muted-foreground">
          Carregando…
        </p>
      )
    case 'signedOut':
      return <LoginForm />
    case 'failed':
      return (
        <div className="mt-6 grid gap-4">
          <p role="alert" className="text-destructive">
            {state.message}
          </p>
          <div className="flex gap-2">
            <Button onClick={retry}>Tentar de novo</Button>
            <Button
              variant="outline"
              onClick={() => {
                void signOut()
              }}
            >
              Sair
            </Button>
          </div>
        </div>
      )
    case 'signedIn':
      return <>{children(state.profile, { offline: false })}</>
    case 'offline':
      return <>{children(state.profile, { offline: true })}</>
  }
}
