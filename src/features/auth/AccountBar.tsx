import type { Role } from '@/domain/types'
import { Button } from '@/design-system/components/ui/button'
import type { UserProfile } from '@/lib/supabase/mappers'
import { useAuth } from './auth-context'

const ROLE_LABELS: Record<Role, string> = {
  admin: 'Administrador',
  supplier: 'Fornecedor',
}

/** Quem está logado, com o papel, a versão do app e a saída. */
export function AccountBar({ profile }: { profile: UserProfile }) {
  const { signOut } = useAuth()
  const name = profile.fullName.trim() === '' ? 'Sem nome cadastrado' : profile.fullName

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground">
          {name} · {ROLE_LABELS[profile.role]}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            void signOut()
          }}
        >
          Sair
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Versão {__APP_VERSION__}</p>
    </div>
  )
}
