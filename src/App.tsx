import { StatusBadge } from '@/design-system/components/StatusBadge/StatusBadge'
import { VISIT_STATUSES } from '@/domain/types'
import { AccountBar } from '@/features/auth/AccountBar'
import { AuthGate } from '@/features/auth/AuthGate'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { AuthGateway } from '@/lib/supabase/auth'

export default function App({ gateway }: { gateway: AuthGateway }) {
  return (
    <AuthProvider gateway={gateway}>
      <main className="mx-auto max-w-xl p-4">
        <h1 className="text-2xl font-semibold">Rota do repositor</h1>
        <AuthGate>
          {(profile) => (
            <>
              <AccountBar profile={profile} />
              <p className="mt-2 text-muted-foreground">
                Estrutura pronta. As telas entram a partir daqui.
              </p>
              <ul className="mt-4 flex flex-wrap gap-2" aria-label="Status de uma visita">
                {VISIT_STATUSES.map((status) => (
                  <li key={status}>
                    <StatusBadge status={status} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </AuthGate>
      </main>
    </AuthProvider>
  )
}
