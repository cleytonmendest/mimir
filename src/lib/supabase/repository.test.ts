import { describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import type { AppSupabaseClient } from './client'
import { DataError } from './errors'
import { getProfile, listMarkets, listStandardRoute, listVisits } from './repository'

type Result = { data: unknown; error: { message: string } | null }
type Call = [method: string, ...args: unknown[]]

/**
 * Cliente falso: registra as chamadas encadeadas e entrega o resultado no `await`. Só confere como
 * a consulta é montada; como o banco responde de verdade é coisa do teste contra o Supabase local.
 */
function fakeClient(result: Result) {
  const calls: Call[] = []
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'then') return (resolve: (value: Result) => void) => resolve(result)
        return (...args: unknown[]) => {
          calls.push([String(property), ...args])
          return builder
        }
      },
    },
  )
  const client = {
    from: (table: string) => {
      calls.push(['from', table])
      return builder
    },
  } as unknown as AppSupabaseClient
  return { client, calls }
}

const visitRow: Tables<'visits'> = {
  id: 'v-1',
  repositor_id: 'u-ana',
  market_id: 'm-a',
  visit_date: '2026-10-21',
  position: 0,
  status: 'planned',
  origin: 'standard',
  carried_from_date: null,
  check_in_at: null,
  check_out_at: null,
  note: null,
  skip_reason: null,
  created_at: '2026-10-20T09:00:00+00:00',
  updated_at: '2026-10-20T09:00:00+00:00',
}

const range = { from: '2026-10-19', to: '2026-10-25' }

describe('listVisits', () => {
  it('pede o intervalo na ordem da agenda e devolve visitas do domínio', async () => {
    const { client, calls } = fakeClient({ data: [visitRow], error: null })

    const visits = await listVisits(client, range)

    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({ id: 'v-1', repositorId: 'u-ana', date: '2026-10-21' })
    expect(calls).toEqual([
      ['from', 'visits'],
      ['select', '*'],
      ['gte', 'visit_date', '2026-10-19'],
      ['lte', 'visit_date', '2026-10-25'],
      ['order', 'visit_date'],
      ['order', 'position'],
    ])
  })

  it('filtra por repositor só quando pedido (o líder vê todos)', async () => {
    const { client, calls } = fakeClient({ data: [], error: null })

    await listVisits(client, { ...range, repositorId: 'u-ana' })

    expect(calls).toContainEqual(['eq', 'repositor_id', 'u-ana'])
  })

  it('erro do servidor vira DataError e guarda a causa', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'permission denied' } })

    const failure = await listVisits(client, range).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(DataError)
    expect(failure).toMatchObject({ code: 'QUERY_FAILED', cause: { message: 'permission denied' } })
    expect((failure as DataError).message).toContain('as visitas')
  })
})

describe('listStandardRoute', () => {
  const row: Tables<'standard_route'> = {
    id: 'r-1',
    repositor_id: 'u-ana',
    weekday: 2,
    market_id: 'm-a',
    position: 0,
    created_at: '2026-10-20T09:00:00+00:00',
  }

  it('lista a rota por dia e posição, de todos ou de um repositor', async () => {
    const all = fakeClient({ data: [row], error: null })
    expect(await listStandardRoute(all.client)).toEqual([
      { repositorId: 'u-ana', weekday: 2, marketId: 'm-a', order: 0 },
    ])
    expect(all.calls.some(([method]) => method === 'eq')).toBe(false)

    const one = fakeClient({ data: [], error: null })
    await listStandardRoute(one.client, 'u-ana')
    expect(one.calls).toContainEqual(['eq', 'repositor_id', 'u-ana'])
  })

  it('erro do servidor vira DataError', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } })
    await expect(listStandardRoute(client)).rejects.toBeInstanceOf(DataError)
  })
})

describe('listMarkets', () => {
  it('lista os mercados em ordem de nome', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          id: 'm-a',
          name: 'Mercado A',
          address: 'Rua 1',
          archived_at: null,
          created_at: '2026-10-20T09:00:00+00:00',
        },
      ],
      error: null,
    })

    expect(await listMarkets(client)).toEqual([
      { id: 'm-a', name: 'Mercado A', address: 'Rua 1', archived: false },
    ])
    expect(calls).toContainEqual(['order', 'name'])
  })

  it('erro do servidor vira DataError', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } })
    await expect(listMarkets(client)).rejects.toBeInstanceOf(DataError)
  })
})

describe('getProfile', () => {
  it('devolve o perfil encontrado', async () => {
    const { client, calls } = fakeClient({
      data: {
        id: 'u-ana',
        role: 'repositor',
        full_name: 'Ana',
        created_at: '2026-10-20T09:00:00+00:00',
      },
      error: null,
    })

    expect(await getProfile(client, 'u-ana')).toEqual({
      id: 'u-ana',
      role: 'repositor',
      fullName: 'Ana',
    })
    expect(calls).toContainEqual(['eq', 'id', 'u-ana'])
  })

  it('devolve null quando não existe ou não é visível', async () => {
    const { client } = fakeClient({ data: null, error: null })
    expect(await getProfile(client, 'u-x')).toBeNull()
  })

  it('erro do servidor vira DataError', async () => {
    const { client } = fakeClient({ data: null, error: { message: 'boom' } })
    await expect(getProfile(client, 'u-ana')).rejects.toBeInstanceOf(DataError)
  })
})
