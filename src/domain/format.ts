import { parseIsoDate } from './dates'
import type { YearMonth } from './calendar'
import type { IsoDate } from './types'

/**
 * Datas em português para a tela. Tudo em UTC de propósito: a data é de calendário, sem hora, e o
 * resultado não pode depender do fuso da máquina (a CI roda nos 4 fusos).
 */

const LONG_DATE = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  timeZone: 'UTC',
})
const WEEKDAY_SHORT = new Intl.DateTimeFormat('pt-BR', { weekday: 'short', timeZone: 'UTC' })
const WEEKDAY_LONG = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', timeZone: 'UTC' })
const MONTH_YEAR = new Intl.DateTimeFormat('pt-BR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "Sábado, 24 de outubro". */
export function longDate(date: IsoDate): string {
  return capitalize(LONG_DATE.format(parseIsoDate(date)))
}

/** "24/10". */
export function dayMonth(date: IsoDate): string {
  const [, month, day] = date.split('-')
  return `${day}/${month}`
}

/** "sáb 24/10". */
export function shortDate(date: IsoDate): string {
  return `${WEEKDAY_SHORT.format(parseIsoDate(date)).replace('.', '')} ${dayMonth(date)}`
}

/** "Outubro de 2026". */
export function monthTitle(value: YearMonth): string {
  return capitalize(MONTH_YEAR.format(new Date(Date.UTC(value.year, value.month - 1, 1))))
}

/** Os dias da semana, de domingo a sábado: "dom" e "domingo". */
export function weekdayLabels(): { short: string; full: string }[] {
  // 2026-11-01 é um domingo.
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 10, 1 + index))
    return { short: WEEKDAY_SHORT.format(date).replace('.', ''), full: WEEKDAY_LONG.format(date) }
  })
}

/** "1 vaga livre", "2 vagas livres". */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}
