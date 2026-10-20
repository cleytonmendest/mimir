import { weekDates, weekdayOf } from './dates'
import { keyOf, visitKey } from './keys'
import type { IsoDate, StandardRouteEntry, Visit } from './types'

export interface GenerateWeekInput {
  route: readonly StandardRouteEntry[]
  existing: readonly Visit[]
  repositorId: string
  /** Qualquer dia da semana desejada. */
  weekOf: IsoDate
  today: IsoDate
  newId: () => string
}

/**
 * Devolve só as visitas NOVAS a inserir. É idempotente: chamar duas vezes com o
 * resultado da primeira devolve lista vazia. Qualquer visita existente na mesma
 * (repositor, mercado, dia), inclusive cancelada, conta como já resolvida, e é
 * isso que impede de "ressuscitar" o que alguém removeu ou remanejou.
 */
export function generateWeek(input: GenerateWeekInput): Visit[] {
  const { route, existing, repositorId, weekOf, today, newId } = input
  const taken = new Set(existing.map(keyOf))
  const created: Visit[] = []

  for (const date of weekDates(weekOf)) {
    if (date < today) continue

    const weekday = weekdayOf(date)
    const entries = route
      .filter((entry) => entry.repositorId === repositorId && entry.weekday === weekday)
      .sort((a, b) => a.order - b.order)

    for (const entry of entries) {
      const key = visitKey(repositorId, entry.marketId, date)
      if (taken.has(key)) continue
      taken.add(key)
      created.push({
        id: newId(),
        repositorId,
        marketId: entry.marketId,
        date,
        order: entry.order,
        status: 'planned',
        origin: 'standard',
        carriedFromDate: null,
        checkInAt: null,
        checkOutAt: null,
        note: null,
        skipReason: null,
      })
    }
  }

  return created
}
