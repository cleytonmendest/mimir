import type { Actor, IsoDate } from '@/domain/types'
import type { Tables } from '@/lib/database.types'

/**
 * Linha do banco <-> tipo do domínio. A atribuição do papel só compila enquanto banco e domínio
 * tiverem os mesmos valores: o tipo gerado é a segunda trava, depois de domain/schema-sync.test.ts.
 */

export interface Market {
  id: string
  name: string
  address: string | null
  archived: boolean
  /** Estandes por dia. */
  capacity: number
}

export interface UserProfile extends Actor {
  fullName: string
}

export function marketFromRow(row: Tables<'markets'>): Market {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    archived: row.archived_at !== null,
    capacity: row.capacity,
  }
}

export function profileFromRow(row: Tables<'profiles'>): UserProfile {
  return { id: row.id, role: row.role, fullName: row.full_name }
}

/** Uma reserva ativa do fornecedor logado, com o nome do mercado. */
export interface MyBooking {
  id: string
  marketId: string
  marketName: string
  day: IsoDate
}

/** Uma reserva ativa, como o administrador a vê: com o nome do fornecedor. */
export interface AdminBooking extends MyBooking {
  supplierId: string
  supplierName: string
}

export interface ClosedDay {
  day: IsoDate
  reason: string | null
}

export type { MarketInput } from '@/domain/market'

type MyBookingRow = Pick<Tables<'bookings'>, 'id' | 'market_id' | 'day'> & {
  markets: { name: string } | null
}

export function myBookingFromRow(row: MyBookingRow): MyBooking {
  return {
    id: row.id,
    marketId: row.market_id,
    marketName: row.markets?.name ?? '',
    day: row.day,
  }
}

export function adminBookingFromRow(
  row: MyBookingRow & Pick<Tables<'bookings'>, 'supplier_id'> & { profiles: { full_name: string } | null },
): AdminBooking {
  return {
    ...myBookingFromRow(row),
    supplierId: row.supplier_id,
    supplierName: row.profiles?.full_name ?? '',
  }
}
