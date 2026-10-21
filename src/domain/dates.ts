import { DomainError } from './errors'
import type { IsoDate, Weekday } from './types'

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * O fuso da empresa. O "dia" de uma visita é sempre o deste fuso, nunca o do aparelho: um celular
 * com o fuso trocado não pode mudar o que é "hoje". Tem de ser o mesmo de public.company_date() no
 * banco (domain/schema-sync.test.ts confere).
 */
export const COMPANY_TIME_ZONE = 'America/Sao_Paulo'

const COMPANY_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: COMPANY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/** A data de calendário em que o instante cai no fuso da empresa ("AAAA-MM-DD"). */
export function companyDate(instant: string | Date): IsoDate {
  const date = typeof instant === 'string' ? new Date(instant) : instant
  if (Number.isNaN(date.getTime())) {
    throw new DomainError('INVALID_DATE', `Instante inválido: ${String(instant)}`)
  }
  return COMPANY_DAY.format(date)
}

/** O resto deste arquivo trabalha em UTC de propósito: o resultado não pode depender do fuso da máquina. */
export function parseIsoDate(date: IsoDate): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const parsed = new Date(Date.UTC(year, month - 1, day))
  if (!ISO_DATE.test(date) || parsed.toISOString().slice(0, 10) !== date) {
    throw new DomainError('INVALID_DATE', `Data inválida: ${date}`)
  }
  return parsed
}

export function toIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10)
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const parsed = parseIsoDate(date)
  parsed.setUTCDate(parsed.getUTCDate() + days)
  return toIsoDate(parsed)
}

/** Quantos dias de calendário vão de `from` até `to` (negativo se `to` for antes). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parseIsoDate(to).getTime() - parseIsoDate(from).getTime()) / 86_400_000)
}

export function weekdayOf(date: IsoDate): Weekday {
  return parseIsoDate(date).getUTCDay() as Weekday
}

/** A semana começa na segunda-feira. */
export function startOfWeek(date: IsoDate): IsoDate {
  const offset = (weekdayOf(date) + 6) % 7
  return addDays(date, -offset)
}

export function weekDates(anyDateInWeek: IsoDate): IsoDate[] {
  const start = startOfWeek(anyDateInWeek)
  return Array.from({ length: 7 }, (_, index) => addDays(start, index))
}
