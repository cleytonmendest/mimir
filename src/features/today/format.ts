import type { IsoDate } from '@/domain/types'

/** Hora no relógio do aparelho, "08:12". */
export function formatTime(instant: string): string {
  return new Date(instant).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

/** "Quarta-feira, 21 de outubro". */
export function formatLongDate(day: IsoDate): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  const text = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date(year, month - 1, date))
  return text.charAt(0).toUpperCase() + text.slice(1)
}
