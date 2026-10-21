import { useState } from 'react'
import type { Role } from '@/domain/types'
import { Button } from '@/design-system/components/ui/button'
import type { UserProfile } from '@/lib/supabase/mappers'
import { useAuth } from './auth-context'

const ROLE_LABELS: Record<Role, string> = {
  repositor: 'Repositor',
  leader: 'Líder',
}

function recordsLabel(count: number): string {
  return count === 1 ? '1 registro' : `${count} registros`
}

/**
 * Quem está logado, com o papel, a versão do app e a saída. Sair com trabalho ainda não enviado pede
 * confirmação, ali mesmo (sem janela por cima): nada é apagado, mas sem entrar de novo o trabalho
 * não chega ao líder.
 */
export function AccountBar({
  profile,
  unsentCount,
}: {
  profile: UserProfile
  /** Quantos registros deste aparelho ainda não foram enviados ao servidor. */
  unsentCount?: () => Promise<number>
}) {
  const { signOut } = useAuth()
  const [confirming, setConfirming] = useState<number | null>(null)
  const name = profile.fullName.trim() === '' ? 'Sem nome cadastrado' : profile.fullName

  async function requestSignOut() {
    let unsent = 0
    try {
      unsent = (await unsentCount?.()) ?? 0
    } catch {
      // sem conseguir contar, não dá para avisar; sair não apaga nada
    }
    if (unsent > 0) setConfirming(unsent)
    else await signOut()
  }

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground">
          {name} · {ROLE_LABELS[profile.role]}
        </p>
        <Button
          variant="outline"
          onClick={() => {
            void requestSignOut()
          }}
        >
          Sair
        </Button>
      </div>
      {confirming !== null && (
        <div
          role="group"
          aria-label="Confirmar saída"
          className="mt-3 grid gap-3 rounded-lg border border-destructive p-3"
        >
          <p>
            Há {recordsLabel(confirming)} neste aparelho que ainda não foram enviados. Eles ficam
            guardados aqui e só chegam ao líder quando você entrar de novo, com internet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              onClick={() => {
                setConfirming(null)
                void signOut()
              }}
            >
              Sair mesmo assim
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setConfirming(null)
              }}
            >
              Continuar no app
            </Button>
          </div>
        </div>
      )}
      <p className="mt-1 text-sm text-muted-foreground">Versão {__APP_VERSION__}</p>
    </div>
  )
}
