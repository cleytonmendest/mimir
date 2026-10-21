import type { AppSupabaseClient } from './client'
import { DataError } from './errors'
import { marketFromRow, profileFromRow, type Market, type UserProfile } from './mappers'

/**
 * O que cada pessoa enxerga ou pode gravar quem decide é o RLS do banco; aqui só se pede e se
 * converte de/para o domínio.
 */

function failed(action: string, cause: { message: string }): DataError {
  return new DataError('QUERY_FAILED', `Não foi possível ${action}: ${cause.message}`, { cause })
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
