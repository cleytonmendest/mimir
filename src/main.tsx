import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { createOfflineRuntime } from './lib/offline/runtime.ts'
import { createAuthGateway } from './lib/supabase/auth.ts'
import { createSyncGateway } from './lib/supabase/sync-gateway.ts'
import { createVisitsGateway } from './lib/supabase/visits-gateway.ts'

const container = document.getElementById('root')
if (container === null) throw new Error('Elemento #root não encontrado')
const root = createRoot(container)

try {
  // O app depende de guardar dados no aparelho (a fila de envio): sem isso, não abre pela metade.
  const runtime = await createOfflineRuntime(createSyncGateway())
  root.render(
    <StrictMode>
      <App auth={createAuthGateway()} visits={createVisitsGateway()} runtime={runtime} />
    </StrictMode>,
  )
} catch {
  root.render(
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-semibold">Rota do repositor</h1>
      <p role="alert" className="mt-6 text-destructive">
        Este navegador não deixou o app guardar dados no aparelho, e sem isso ele não funciona sem
        sinal. Abra o app no navegador comum (não em aba anônima) e libere espaço no celular.
      </p>
    </main>,
  )
}
