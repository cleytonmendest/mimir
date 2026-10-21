import { AccountBar } from '@/features/auth/AccountBar'
import { AuthGate } from '@/features/auth/AuthGate'
import { AuthProvider } from '@/features/auth/AuthProvider'
import type { AuthGateway } from '@/lib/supabase/auth'

export default function App({ auth }: { auth: AuthGateway }) {
  return (
    <AuthProvider gateway={auth}>
      <main className="mx-auto max-w-xl p-4">
        <h1 className="text-2xl font-semibold">Agenda de Degustações</h1>
        <AuthGate>
          {(profile) => (
            <>
              <AccountBar profile={profile} />
              {profile.role === 'admin' ? (
                <section className="mt-6" aria-labelledby="markets-title">
                  <h2 id="markets-title" className="text-xl font-semibold">
                    Mercados
                  </h2>
                  <p className="mt-2 text-muted-foreground">
                    Aqui você vai definir o limite de estandes de cada mercado, fechar datas e ver
                    quem reservou.
                  </p>
                </section>
              ) : (
                <section className="mt-6" aria-labelledby="bookings-title">
                  <h2 id="bookings-title" className="text-xl font-semibold">
                    Reservas
                  </h2>
                  <p className="mt-2 text-muted-foreground">
                    Aqui você vai escolher o mercado e o dia e reservar o seu estande.
                  </p>
                </section>
              )}
            </>
          )}
        </AuthGate>
      </main>
    </AuthProvider>
  )
}
