import { describe, expect, it } from 'vitest'
import type { AppSupabaseClient } from './client'
import { DataError } from './errors'
import { getProfile, listMarkets } from './repository'

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

describe('listMarkets', () => {
  it('lista os mercados em ordem de nome', async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          id: 'm-a',
          name: 'Mercado A',
          address: 'Rua 1',
          archived_at: null,
          capacity: 3,
          created_at: '2026-10-20T09:00:00+00:00',
        },
      ],
      error: null,
    })

    expect(await listMarkets(client)).toEqual([
      { id: 'm-a', name: 'Mercado A', address: 'Rua 1', archived: false, capacity: 3 },
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
        role: 'supplier',
        full_name: 'Ana',
        created_at: '2026-10-20T09:00:00+00:00',
      },
      error: null,
    })

    expect(await getProfile(client, 'u-ana')).toEqual({
      id: 'u-ana',
      role: 'supplier',
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
