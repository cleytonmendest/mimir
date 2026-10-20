import type { Actor, Visit } from './types'

/** Apoio só para testes e stories. Não importar em código de produção. */

export const leader: Actor = { id: 'leader-1', role: 'leader' }
export const ana: Actor = { id: 'repo-ana', role: 'repositor' }
export const bruno: Actor = { id: 'repo-bruno', role: 'repositor' }

export function idGenerator(prefix = 'id'): () => string {
  let counter = 0
  return () => `${prefix}-${++counter}`
}

export function makeVisit(overrides: Partial<Visit> = {}): Visit {
  return {
    id: 'visit-1',
    repositorId: ana.id,
    marketId: 'market-a',
    date: '2026-10-21',
    order: 0,
    status: 'planned',
    origin: 'standard',
    carriedFromDate: null,
    checkInAt: null,
    checkOutAt: null,
    note: null,
    skipReason: null,
    ...overrides,
  }
}

/** Congela recursivamente: se alguma função tentar mutar a entrada, o teste quebra. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
