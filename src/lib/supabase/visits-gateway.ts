import type { IsoDate, StandardRouteEntry, Visit } from '@/domain/types'
import { getSupabase, type AppSupabaseClient } from './client'
import type { Market } from './mappers'
import {
  createVisits,
  listMarkets,
  listStandardRoute,
  listVisits,
  saveVisitChange,
  type VisitChange,
} from './repository'

export type { VisitChange }

/** O que as telas de visitas precisam do servidor, sem tipo do SDK. */
export interface VisitsGateway {
  listVisits(range: { from: IsoDate; to: IsoDate; repositorId?: string }): Promise<Visit[]>
  listStandardRoute(repositorId?: string): Promise<StandardRouteEntry[]>
  listMarkets(): Promise<Market[]>
  /** Cria as visitas que ainda não existem; as que já existem ficam como estão. */
  createVisits(visits: readonly Visit[]): Promise<void>
  /**
   * Grava as mudanças na ordem recebida e para na primeira que falhar. Cada uma só vale se a visita
   * ainda estiver como a tela a viu; senão falha com DataError CONFLICT.
   */
  saveChanges(changes: readonly VisitChange[]): Promise<void>
}

/** O cliente só é pedido na hora de usar: sem .env o app abre e a falha aparece como erro de config. */
export function createVisitsGateway(
  getClient: () => AppSupabaseClient = getSupabase,
): VisitsGateway {
  return {
    async listVisits(range) {
      return listVisits(getClient(), range)
    },
    async listStandardRoute(repositorId) {
      return listStandardRoute(getClient(), repositorId)
    },
    async listMarkets() {
      return listMarkets(getClient())
    },
    async createVisits(visits) {
      await createVisits(getClient(), visits)
    },
    async saveChanges(changes) {
      const client = getClient()
      for (const change of changes) await saveVisitChange(client, change)
    },
  }
}
