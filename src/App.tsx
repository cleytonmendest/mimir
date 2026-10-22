import { AdminScreen } from '@/features/admin/AdminScreen'
import { resolveRoute } from '@/features/access/routes'
import { SetPasswordPage } from '@/features/access/SetPasswordPage'
import { SignupPage } from '@/features/access/SignupPage'
import { AccountBar } from '@/features/auth/AccountBar'
import { AuthGate } from '@/features/auth/AuthGate'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { SupplierScreen } from '@/features/booking/SupplierScreen'
import type { AccessGateway } from '@/lib/supabase/access-gateway'
import type { AuthGateway } from '@/lib/supabase/auth'
import type { BookingGateway } from '@/lib/supabase/booking-gateway'

/** Depois de definir a senha ou criar a conta, volta à tela principal (já logado). */
function goHome() {
  window.location.assign('/')
}

export default function App({
  auth,
  booking,
  access,
  now,
  location = window.location,
  onDone = goHome,
}: {
  auth: AuthGateway
  booking: BookingGateway
  access: AccessGateway
  now?: () => Date
  /** O endereço aberto (só os testes passam outro). */
  location?: { pathname: string; search: string; origin?: string }
  onDone?: () => void
}) {
  const route = resolveRoute(location)
  const origin = location.origin
  const title = (
    <h1 className="font-display text-4xl font-bold tracking-wide uppercase">
      Agenda de Degustações
    </h1>
  )

  if (route.page === 'activation') {
    return (
      <main className="mx-auto w-full max-w-[1240px] p-4">
        {title}
        <SetPasswordPage auth={auth} token={route.token} onDone={onDone} />
      </main>
    )
  }

  if (route.page === 'signup') {
    return (
      <main className="mx-auto w-full max-w-[1240px] p-4">
        {title}
        <SignupPage access={access} auth={auth} code={route.code} onDone={onDone} />
      </main>
    )
  }

  return (
    <AuthProvider gateway={auth}>
      <main className="mx-auto w-full max-w-[1240px] p-4">
        {title}
        <AuthGate>
          {(profile) => (
            <>
              <AccountBar profile={profile} />
              {profile.role === 'admin' ? (
                <AdminScreen
                  key={profile.id}
                  gateway={booking}
                  access={access}
                  {...(now === undefined ? {} : { now })}
                  {...(origin === undefined ? {} : { origin })}
                />
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
