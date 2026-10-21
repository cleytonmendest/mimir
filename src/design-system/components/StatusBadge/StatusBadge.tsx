import type { VisitStatus } from '@/domain/types'

/**
 * Record<VisitStatus, ...> é exaustivo: criar um status novo no domínio sem dar
 * rótulo e cor a ele é erro de compilação, não badge quebrado em produção.
 */
const STATUS_STYLES: Record<VisitStatus, { label: string; className: string }> = {
  planned: { label: 'Planejada', className: 'bg-status-planned text-status-planned-fg' },
  in_progress: {
    label: 'Em andamento',
    className: 'bg-status-in-progress text-status-in-progress-fg',
  },
  done: { label: 'Feita', className: 'bg-status-done text-status-done-fg' },
  not_done: { label: 'Não foi', className: 'bg-status-not-done text-status-not-done-fg' },
  cancelled: { label: 'Cancelada', className: 'bg-status-cancelled text-status-cancelled-fg' },
}

export function StatusBadge({ status }: { status: VisitStatus }) {
  const { label, className } = STATUS_STYLES[status]
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full whitespace-nowrap px-3 py-1 text-sm font-medium ${className}`}
    >
      {label}
    </span>
  )
}
