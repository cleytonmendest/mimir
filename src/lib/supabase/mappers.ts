import type { Actor, StandardRouteEntry, Visit, Weekday } from '@/domain/types'
import type { Tables } from '@/lib/database.types'
import { DataError } from './errors'

/**
 * Linha do banco -> tipo do domínio. As atribuições de enum (status, origem, papel) só compilam
 * enquanto banco e domínio tiverem os mesmos valores: o tipo gerado é a segunda trava, depois de
 * domain/schema-sync.test.ts.
 */

export interface Market {
  id: string
  name: string
  address: string | null
  archived: boolean
}

export interface UserProfile extends Actor {
  fullName: string
}

/** O Postgres devolve "2026-10-20T19:24:09.123456+00:00"; o domínio trabalha com ISO canônico. */
function toInstant(value: string): string {
  return new Date(value).toISOString()
}

function toInstantOrNull(value: string | null): string | null {
  return value === null ? null : toInstant(value)
}

const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6]

function toWeekday(value: number): Weekday {
  const weekday = WEEKDAYS.find((candidate) => candidate === value)
  if (weekday === undefined) {
    throw new DataError('INVALID_ROW', `Dia da semana inválido na rota padrão: ${value}`)
  }
  return weekday
}

export function visitFromRow(row: Tables<'visits'>): Visit {
  return {
    id: row.id,
    repositorId: row.repositor_id,
    marketId: row.market_id,
    date: row.visit_date,
    order: row.position,
    status: row.status,
    origin: row.origin,
    carriedFromDate: row.carried_from_date,
    checkInAt: toInstantOrNull(row.check_in_at),
    checkOutAt: toInstantOrNull(row.check_out_at),
    note: row.note,
    skipReason: row.skip_reason,
  }
}

export function routeEntryFromRow(row: Tables<'standard_route'>): StandardRouteEntry {
  return {
    repositorId: row.repositor_id,
    weekday: toWeekday(row.weekday),
    marketId: row.market_id,
    order: row.position,
  }
}

export function marketFromRow(row: Tables<'markets'>): Market {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    archived: row.archived_at !== null,
  }
}

export function profileFromRow(row: Tables<'profiles'>): UserProfile {
  return { id: row.id, role: row.role, fullName: row.full_name }
}
