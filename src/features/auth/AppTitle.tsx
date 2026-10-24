import { cn } from '@/design-system/utils'

/** O nome do app: o único título de nível 1 de cada tela. */
export function AppTitle({ centered = false }: { centered?: boolean }) {
  return (
    <h1
      className={cn(
        'font-display text-3xl font-semibold tracking-wide uppercase sm:text-4xl',
        centered && 'text-center',
      )}
    >
      Agenda de Degustações
    </h1>
  )
}
