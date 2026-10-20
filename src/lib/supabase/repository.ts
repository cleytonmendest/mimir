import type { IsoDate, StandardRouteEntry, Visit } from '@/domain/types'
import type { AppSupabaseClient } from './client'
import { DataError } from './errors'
import {
  marketFromRow,
  profileFromRow,
  routeEntryFromRow,
  visitFromRow,
  type Market,
  type UserProfile,
} from './mappers'

/**
 * Leituras. O que cada pessoa enxerga quem decide é o RLS do banco (repositor vê só o que é dele,
 * líder vê tudo); aqui só se pede e se converte para o domínio.
 *
 * Só leitura por enquanto. Escrever visita não é um upsert: o INSERT ... ON CONFLICT passa pela
 * policy de insert (status = 'planned') mesmo quando vira update, e o repositor seria barrado.
 * As escritas entram por operação (update por id, insert de novas) junto com a tela que as usa.
 */

function failed(what: string, cause: { message: string }): DataError {
  return new DataError('QUERY_FAILED', `Não foi possível ler ${what}: ${cause.message}`, { cause })
}

/** Visitas de [from, to] (inclusive), na ordem da agenda: dia e depois a posição na rota. */
export async function listVisits(
  client: AppSupabaseClient,
  range: { from: IsoDate; to: IsoDate; repositorId?: string },
): Promise<Visit[]> {
  let query = client
    .from('visits')
    .select('*')
    .gte('visit_date', range.from)
    .lte('visit_date', range.to)
  if (range.repositorId !== undefined) query = query.eq('repositor_id', range.repositorId)

  const { data, error } = await query.order('visit_date').order('position')
  if (error !== null) throw failed('as visitas', error)
  return data.map(visitFromRow)
}

export async function listStandardRoute(
  client: AppSupabaseClient,
  repositorId?: string,
): Promise<StandardRouteEntry[]> {
  let query = client.from('standard_route').select('*')
  if (repositorId !== undefined) query = query.eq('repositor_id', repositorId)

  const { data, error } = await query.order('weekday').order('position')
  if (error !== null) throw failed('a rota padrão', error)
  return data.map(routeEntryFromRow)
}

export async function listMarkets(client: AppSupabaseClient): Promise<Market[]> {
  const { data, error } = await client.from('markets').select('*').order('name')
  if (error !== null) throw failed('os mercados', error)
  return data.map(marketFromRow)
}

/** null quando o perfil não existe (ou não é visível para quem pergunta). */
export async function getProfile(
  client: AppSupabaseClient,
  userId: string,
): Promise<UserProfile | null> {
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error !== null) throw failed('o perfil', error)
  return data === null ? null : profileFromRow(data)
}
