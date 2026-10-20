import { StatusBadge } from '@/design-system/components/StatusBadge/StatusBadge'
import { VISIT_STATUSES } from '@/domain/types'

export default function App() {
  return (
    <main className="mx-auto max-w-xl p-4">
      <h1 className="text-2xl font-semibold">Rota do repositor</h1>
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
    </main>
  )
}
