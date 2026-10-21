import type { IsoDate, StandardRouteEntry, Visit } from '@/domain/types'
import type { AppSupabaseClient } from './client'
import { DataError } from './errors'
import {
  executionPatch,
  marketFromRow,
  profileFromRow,
  routeEntryFromRow,
  visitFromRow,
  visitToInsertRow,
  type Market,
  type UserProfile,
} from './mappers'

/**
 * O que cada pessoa enxerga ou pode gravar quem decide é o RLS do banco (repositor mexe só no que é
 * dele, líder em tudo); aqui só se pede e se converte de/para o domínio.
 *
 * Não existe "salvar visita" genérico (upsert): o INSERT ... ON CONFLICT passa pela policy de
 * insert (status = 'planned') mesmo quando vira update, e o repositor seria barrado. Cada escrita
 * é uma operação própria: criar visitas novas, ou aplicar uma mudança de execução.
 */

function failed(action: string, cause: { message: string }): DataError {
  return new DataError('QUERY_FAILED', `Não foi possível ${action}: ${cause.message}`, { cause })
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
  if (error !== null) throw failed('ler as visitas', error)
  return data.map(visitFromRow)
}

export async function listStandardRoute(
  client: AppSupabaseClient,
  repositorId?: string,
): Promise<StandardRouteEntry[]> {
  let query = client.from('standard_route').select('*')
  if (repositorId !== undefined) query = query.eq('repositor_id', repositorId)

  const { data, error } = await query.order('weekday').order('position')
  if (error !== null) throw failed('ler a rota padrão', error)
  return data.map(routeEntryFromRow)
}

export async function listMarkets(client: AppSupabaseClient): Promise<Market[]> {
  const { data, error } = await client.from('markets').select('*').order('name')
  if (error !== null) throw failed('ler os mercados', error)
  return data.map(marketFromRow)
}

/** null quando o perfil não existe (ou não é visível para quem pergunta). */
export async function getProfile(
  client: AppSupabaseClient,
  userId: string,
): Promise<UserProfile | null> {
  const { data, error } = await client.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error !== null) throw failed('ler o perfil', error)
  return data === null ? null : profileFromRow(data)
}

/**
 * Cria visitas novas. Se já existe visita do mesmo repositor, no mesmo mercado e dia (por exemplo
 * outro aparelho abriu a semana ao mesmo tempo), a existente fica como está: nada é sobrescrito.
 */
export async function createVisits(
  client: AppSupabaseClient,
  visits: readonly Visit[],
): Promise<void> {
  if (visits.length === 0) return

  const { error } = await client.from('visits').upsert(visits.map(visitToInsertRow), {
    onConflict: 'repositor_id,market_id,visit_date',
    ignoreDuplicates: true,
  })
  if (error !== null) throw failed('criar as visitas', error)
}

/** A visita como estava quando a tela a carregou (before) e como ficou depois da ação (after). */
export interface VisitChange {
  before: Visit
  after: Visit
}

/**
 * Grava o resultado de uma ação de execução, só se a visita ainda estiver no status em que a tela a
 * viu (compare-and-set). Se o líder cancelou, ou outro aparelho já avançou a visita, nada é gravado
 * e o resultado é CONFLICT: quem manda é o servidor.
 */
export async function saveVisitChange(
  client: AppSupabaseClient,
  change: VisitChange,
): Promise<void> {
  const { data, error } = await client
    .from('visits')
    .update(executionPatch(change.after))
    .eq('id', change.after.id)
    .eq('status', change.before.status)
    .select('id')
  if (error !== null) throw failed('salvar a visita', error)
  if (data.length === 0) {
    throw new DataError('CONFLICT', 'A visita mudou no servidor depois que você a abriu')
  }
}
