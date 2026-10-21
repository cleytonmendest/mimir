import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '@/design-system/components/ui/button'
import type { OfflineRuntime, UserSession } from '@/lib/offline/runtime'

type HostState =
  { status: 'opening' } | { status: 'ready'; session: UserSession } | { status: 'failed' }

/**
 * Abre o que o aparelho tem para este usuário (a fila, o motor de envio e os gatilhos) enquanto a
 * tela dele existe, e fecha ao sair ou trocar de usuário. A fila de quem saiu continua guardada no
 * banco do aparelho; só o motor é desligado.
 */
export function UserSessionHost({
  runtime,
  userId,
  children,
}: {
  runtime: OfflineRuntime
  userId: string
  children: (session: UserSession) => ReactNode
}) {
  const [state, setState] = useState<HostState>({ status: 'opening' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    let opened: UserSession | undefined
    runtime.openUser(userId).then(
      (session) => {
        if (!active) {
          session.close()
          return
        }
        opened = session
        setState({ status: 'ready', session })
      },
      () => {
        if (active) setState({ status: 'failed' })
      },
    )
    return () => {
      active = false
      opened?.close()
    }
  }, [runtime, userId, attempt])

  if (state.status === 'opening') {
    return (
      <p role="status" className="mt-6 text-muted-foreground">
        Preparando o aparelho…
      </p>
    )
  }
  if (state.status === 'failed') {
    return (
      <div className="mt-6 grid gap-4">
        <p role="alert" className="text-destructive">
          Não foi possível usar o armazenamento deste aparelho. Feche outros apps, libere espaço ou
          use o navegador comum (não a aba anônima).
        </p>
        <div>
          <Button
            onClick={() => {
              setState({ status: 'opening' })
              setAttempt((count) => count + 1)
            }}
          >
            Tentar de novo
          </Button>
        </div>
      </div>
    )
  }
  return <>{children(state.session)}</>
}
