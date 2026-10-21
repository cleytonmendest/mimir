import type { Actor } from '@/domain/types'
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
  }
}

export function profileFromRow(row: Tables<'profiles'>): UserProfile {
  return { id: row.id, role: row.role, fullName: row.full_name }
}
