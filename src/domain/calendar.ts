import { addDays, parseIsoDate, weekdayOf } from './dates'
import type { IsoDate } from './types'

/** Um mês do calendário. `month` vai de 1 (janeiro) a 12. */
export interface YearMonth {
  year: number
  month: number
}

export function monthOf(date: IsoDate): YearMonth {
  const parsed = parseIsoDate(date)
  return { year: parsed.getUTCFullYear(), month: parsed.getUTCMonth() + 1 }
}

export function addMonths(value: YearMonth, delta: number): YearMonth {
  const index = value.year * 12 + (value.month - 1) + delta
  return { year: Math.floor(index / 12), month: (index % 12) + 1 }
}

/** Negativo se `a` vem antes de `b`, zero se são o mesmo mês. */
export function compareMonths(a: YearMonth, b: YearMonth): number {
  return a.year * 12 + a.month - (b.year * 12 + b.month)
}

export function firstDayOf(value: YearMonth): IsoDate {
  return `${String(value.year).padStart(4, '0')}-${String(value.month).padStart(2, '0')}-01`
}

export function daysInMonth(value: YearMonth): number {
  return new Date(Date.UTC(value.year, value.month, 0)).getUTCDate()
}

/**
 * As células de um mês, com a semana começando no domingo: `null` nos dias vazios antes do dia 1
 * e a data em cada dia do mês.
 */
export function monthGrid(value: YearMonth): (IsoDate | null)[] {
  const first = firstDayOf(value)
  const blanks = Array.from({ length: weekdayOf(first) }, () => null)
  const days = Array.from({ length: daysInMonth(value) }, (_, index) => addDays(first, index))
  return [...blanks, ...days]
}

/** O primeiro e o último mês que têm algum dia reservável. */
export function bookableMonths(
  today: IsoDate,
  windowDays: number,
): { first: YearMonth; last: YearMonth } {
  return { first: monthOf(addDays(today, 1)), last: monthOf(addDays(today, windowDays)) }
}
