import type { IsoDate, Visit } from './types'

/**
 * Identidade natural de uma visita: um repositor visita um mercado no máximo
 * uma vez por dia. O banco tem o mesmo unique index.
 */
export function visitKey(repositorId: string, marketId: string, date: IsoDate): string {
  return `${repositorId}|${marketId}|${date}`
}

export function keyOf(visit: Pick<Visit, 'repositorId' | 'marketId' | 'date'>): string {
  return visitKey(visit.repositorId, visit.marketId, visit.date)
}
