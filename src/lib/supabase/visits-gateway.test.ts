import { describe, expect, it } from 'vitest'
import type { AppSupabaseClient } from './client'
import { ConfigError } from './errors'
import { createVisitsGateway } from './visits-gateway'

describe('createVisitsGateway', () => {
  it('sem configuração do Supabase todas as operações falham como erro de configuração (e não quebram na criação)', async () => {
    const gateway = createVisitsGateway(() => {
      throw new ConfigError('faltam as variáveis')
    })

    await expect(gateway.listVisits({ from: '2026-10-19', to: '2026-10-25' })).rejects.toBeInstanceOf(
      ConfigError,
    )
    await expect(gateway.listStandardRoute()).rejects.toBeInstanceOf(ConfigError)
    await expect(gateway.listMarkets()).rejects.toBeInstanceOf(ConfigError)
    await expect(gateway.createVisits([])).rejects.toBeInstanceOf(ConfigError)
    await expect(gateway.saveChanges([])).rejects.toBeInstanceOf(ConfigError)
  })

  it('grava as mudanças na ordem recebida e para na primeira que falha', async () => {
    const updates: string[] = []
    const failOn = 'v-2'
    const client = {
      from: () => ({
        update: () => ({
          eq: (column: string, value: string) => {
            if (column === 'id') updates.push(value)
            return {
              eq: () => ({
                select: () =>
                  Promise.resolve(
                    updates.at(-1) === failOn
                      ? { data: null, error: { message: 'boom' } }
                      : { data: [{ id: updates.at(-1) }], error: null },
                  ),
              }),
            }
          },
        }),
      }),
    } as unknown as AppSupabaseClient
    const gateway = createVisitsGateway(() => client)
    const visit = (id: string) => ({
      id,
      repositorId: 'u',
      marketId: 'm',
      date: '2026-10-21',
      order: 0,
      status: 'planned' as const,
      origin: 'standard' as const,
      carriedFromDate: null,
      checkInAt: null,
      checkOutAt: null,
      note: null,
      skipReason: null,
    })
    const change = (id: string) => ({ before: visit(id), after: { ...visit(id), note: 'x' } })

    await expect(
      gateway.saveChanges([change('v-1'), change('v-2'), change('v-3')]),
    ).rejects.toMatchObject({ code: 'QUERY_FAILED' })

    expect(updates).toEqual(['v-1', 'v-2'])
  })
})
