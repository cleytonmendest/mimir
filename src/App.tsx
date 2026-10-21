import { AccountBar } from '@/features/auth/AccountBar'
import { AuthGate } from '@/features/auth/AuthGate'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { UserSessionHost } from '@/features/offline/UserSessionHost'
import type { Clock } from '@/features/today/clock'
import { TodayScreen } from '@/features/today/TodayScreen'
import type { OfflineRuntime } from '@/lib/offline/runtime'
import type { AuthGateway } from '@/lib/supabase/auth'
import type { VisitsGateway } from '@/lib/supabase/visits-gateway'

export default function App({
  auth,
  visits,
  runtime,
  clock,
  sessionTimeoutMs,
}: {
  auth: AuthGateway
  visits: VisitsGateway
  runtime: OfflineRuntime
  clock?: Clock
  /** Quanto esperar o SDK dizer quem está logado antes de abrir com a identidade do aparelho. */
  sessionTimeoutMs?: number
}) {
  return (
    <AuthProvider
      gateway={auth}
      device={runtime.device}
      {...(sessionTimeoutMs === undefined ? {} : { sessionTimeoutMs })}
    >
      <main className="mx-auto max-w-xl p-4">
        <h1 className="text-2xl font-semibold">Rota do repositor</h1>
        <AuthGate>
          {(profile, { offline }) =>
            profile.role === 'repositor' ? (
              <UserSessionHost key={profile.id} runtime={runtime} userId={profile.id}>
                {(session) => (
                  <>
                    <AccountBar
                      profile={profile}
                      unsentCount={async () => (await session.store.pending()).length}
                    />
                    <TodayScreen
                      key={profile.id}
                      profile={profile}
                      gateway={visits}
                      session={session}
                      clock={clock}
                    />
                  </>
                )}
              </UserSessionHost>
            ) : (
              <>
                <AccountBar profile={profile} />
                <p className="mt-6 text-muted-foreground">
                  {offline
                    ? 'Sem conexão. A visão do líder precisa de internet.'
                    : 'A visão do líder (semana de cada repositor) entra a seguir.'}
                </p>
              </>
            )
          }
        </AuthGate>
      </main>
    </AuthProvider>
  )
}
