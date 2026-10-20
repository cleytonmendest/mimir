import { DomainError } from './errors'
import { keyOf } from './keys'
import type { IsoDate, Visit } from './types'

export const NO_RECORD_REASON = 'Sem registro'

/**
 * Fecha o dia: o que ficou "planejado" num dia que já passou vira "não foi".
 * Devolve só as visitas que mudaram.
 */
export function closeDay(visits: readonly Visit[], date: IsoDate, today: IsoDate): Visit[] {
  if (date >= today) return []
  return visits
    .filter((visit) => visit.date === date && visit.status === 'planned')
    .map((visit) => ({ ...visit, status: 'not_done', skipReason: NO_RECORD_REASON }))
}

/**
 * Passa para o dia seguinte o que não foi feito. Devolve só as visitas NOVAS.
 * - uma sobra nunca vira sobra de novo (sem efeito cascata);
 * - idempotente: rodar duas vezes não duplica;
 * - entram no fim da agenda do destino.
 */
export function carryOver(input: {
  visits: readonly Visit[]
  fromDate: IsoDate
  toDate: IsoDate
  newId: () => string
}): Visit[] {
  const { visits, fromDate, toDate, newId } = input
  if (toDate <= fromDate) {
    throw new DomainError('INVALID_CARRYOVER_DATE', 'O destino precisa ser depois da origem')
  }

  const taken = new Set(visits.map(keyOf))
  const nextOrder = new Map<string, number>()
  for (const visit of visits) {
    if (visit.date !== toDate) continue
    nextOrder.set(
      visit.repositorId,
      Math.max(nextOrder.get(visit.repositorId) ?? 0, visit.order + 1),
    )
  }

  const created: Visit[] = []
  const missed = visits
    .filter(
      (visit) =>
        visit.date === fromDate && visit.status === 'not_done' && visit.origin !== 'carryover',
    )
    .sort((a, b) => a.order - b.order)

  for (const visit of missed) {
    const arrival = { ...visit, date: toDate }
    if (taken.has(keyOf(arrival))) continue

    const order = nextOrder.get(visit.repositorId) ?? 0
    nextOrder.set(visit.repositorId, order + 1)
    created.push({
      id: newId(),
      repositorId: visit.repositorId,
      marketId: visit.marketId,
      date: toDate,
      order,
      status: 'planned',
      origin: 'carryover',
      carriedFromDate: fromDate,
      checkInAt: null,
      checkOutAt: null,
      note: null,
      skipReason: null,
    })
  }

  return created
}
