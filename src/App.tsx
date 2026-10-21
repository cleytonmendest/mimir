import { AccountBar } from '@/features/auth/AccountBar'
import { AuthGate } from '@/features/auth/AuthGate'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { SupplierScreen } from '@/features/booking/SupplierScreen'
import type { AuthGateway } from '@/lib/supabase/auth'
import type { BookingGateway } from '@/lib/supabase/booking-gateway'

export default function App({
  auth,
  booking,
  now,
}: {
  auth: AuthGateway
  booking: BookingGateway
  now?: () => Date
}) {
  return (
    <AuthProvider gateway={auth}>
      <main className="mx-auto w-full max-w-[1240px] p-4">
        <h1 className="font-display text-4xl font-bold tracking-wide uppercase">
          Agenda de Degustações
        </h1>
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
                <SupplierScreen
                  key={profile.id}
                  gateway={booking}
                  {...(now === undefined ? {} : { now })}
                />
              )}
            </>
          )}
        </AuthGate>
      </main>
    </AuthProvider>
  )
}
