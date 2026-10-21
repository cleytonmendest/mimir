import { AccountBar } from '@/features/auth/AccountBar'
import { AuthGate } from '@/features/auth/AuthGate'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { Clock } from '@/features/today/clock'
import { TodayScreen } from '@/features/today/TodayScreen'
import type { AuthGateway } from '@/lib/supabase/auth'
import type { VisitsGateway } from '@/lib/supabase/visits-gateway'

export default function App({
  auth,
  visits,
  clock,
}: {
  auth: AuthGateway
  visits: VisitsGateway
  clock?: Clock
}) {
  return (
    <AuthProvider gateway={auth}>
      <main className="mx-auto max-w-xl p-4">
        <h1 className="text-2xl font-semibold">Rota do repositor</h1>
        <AuthGate>
          {(profile) => (
            <>
              <AccountBar profile={profile} />
              {profile.role === 'repositor' ? (
                <TodayScreen key={profile.id} profile={profile} gateway={visits} clock={clock} />
              ) : (
                <p className="mt-6 text-muted-foreground">
                  A visão do líder (semana de cada repositor) entra a seguir.
                </p>
              )}
            </>
          )}
        </AuthGate>
      </main>
    </AuthProvider>
  )
}
