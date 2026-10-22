import { describe, expect, it } from 'vitest'
import { createBookingGateway, toFailure } from './booking-gateway'
import type { AppSupabaseClient } from './client'
import { RequestFailure } from './errors'

interface Result {
  data: unknown
  error: { message: string; code?: string } | null
  status: number
}
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
    rpc: (name: string, args: unknown) => {
      calls.push(['rpc', name, args])
      return builder
    },
  } as unknown as AppSupabaseClient
  return { gateway: createBookingGateway(() => client), calls }
}

const ok = (data: unknown): Result => ({ data, error: null, status: 200 })

const marketRow = {
  id: 'm-a',
  name: 'Mercado A',
  address: null,
  archived_at: null,
  capacity: 3,
  created_at: '2026-10-20T09:00:00+00:00',
}

describe('funções de reserva', () => {
  it('book chama book_slot_v1 com mercado e dia, e valida a resposta', async () => {
    const { gateway, calls } = fakeClient(
      ok({ ok: true, booking_id: 'b-1', already_booked: false, booked: 1, capacity: 3 }),
    )
    expect(await gateway.book('m-a', '2026-10-22')).toEqual({
      ok: true,
      bookingId: 'b-1',
      alreadyBooked: false,
      booked: 1,
      capacity: 3,
    })
    expect(calls).toContainEqual(['rpc', 'book_slot_v1', { p_market: 'm-a', p_day: '2026-10-22' }])
  })

  it('uma recusa de negócio é resultado, não falha', async () => {
    const { gateway } = fakeClient(ok({ ok: false, code: 'FULL' }))
    expect(await gateway.book('m-a', '2026-10-22')).toEqual({ ok: false, code: 'FULL' })
  })

  it('cancel manda o motivo só quando há motivo', async () => {
    const { gateway, calls } = fakeClient(ok({ ok: true, already_cancelled: false }))
    await gateway.cancel('b-1')
    await gateway.cancel('b-2', 'Faltou aviso')
    expect(calls).toContainEqual(['rpc', 'cancel_booking_v1', { p_booking: 'b-1' }])
    expect(calls).toContainEqual([
      'rpc',
      'cancel_booking_v1',
      { p_booking: 'b-2', p_reason: 'Faltou aviso' },
    ])
  })

  it('availability pede o intervalo e devolve o calendário', async () => {
    const { gateway, calls } = fakeClient(
      ok({ ok: true, today: '2026-10-21', capacity: 3, archived: false, days: [] }),
    )
    expect(await gateway.availability('m-a', '2026-10-22', '2026-11-30')).toEqual({
      ok: true,
      archived: false,
      availability: { today: '2026-10-21', capacity: 3, days: [] },
    })
    expect(calls).toContainEqual([
      'rpc',
      'market_availability_v1',
      { p_market: 'm-a', p_from: '2026-10-22', p_to: '2026-11-30' },
    ])
  })

  it('resposta fora da forma é INVALID_RESPONSE', async () => {
    const { gateway } = fakeClient(ok({ ok: 'talvez' }))
    await expect(gateway.book('m-a', '2026-10-22')).rejects.toMatchObject({
      name: 'RequestFailure',
      code: 'INVALID_RESPONSE',
    })
  })

  it('sem corpo na resposta também é INVALID_RESPONSE', async () => {
    const { gateway } = fakeClient(ok(null))
    await expect(gateway.book('m-a', '2026-10-22')).rejects.toBeInstanceOf(RequestFailure)
  })
})

describe('leituras', () => {
  it('listMarkets lista em ordem de nome', async () => {
    const { gateway, calls } = fakeClient(ok([marketRow]))
    expect(await gateway.listMarkets()).toEqual([
      { id: 'm-a', name: 'Mercado A', address: null, archived: false, capacity: 3 },
    ])
    expect(calls).toContainEqual(['order', 'name'])
  })

  it('myBookings: só as ativas, de uma data em diante, com o nome do mercado', async () => {
    const { gateway, calls } = fakeClient(
      ok([{ id: 'b-1', market_id: 'm-a', day: '2026-10-25', markets: { name: 'Mercado A' } }]),
    )
    expect(await gateway.myBookings('2026-10-21')).toEqual([
      { id: 'b-1', marketId: 'm-a', marketName: 'Mercado A', day: '2026-10-25' },
    ])
    expect(calls).toContainEqual(['is', 'cancelled_at', null])
    expect(calls).toContainEqual(['gte', 'day', '2026-10-21'])
  })

  it('adminBookings traz o nome do fornecedor e aceita filtros', async () => {
    const { gateway, calls } = fakeClient(
      ok([
        {
          id: 'b-1',
          market_id: 'm-a',
          day: '2026-10-25',
          supplier_id: 'u-ana',
          markets: { name: 'Mercado A' },
          profiles: { full_name: 'Sabor da Serra' },
        },
        {
          id: 'b-2',
          market_id: 'm-a',
          day: '2026-10-26',
          supplier_id: 'u-bia',
          markets: null,
          profiles: null,
        },
      ]),
    )
    const rows = await gateway.adminBookings({
      from: '2026-10-21',
      to: '2026-11-21',
      marketId: 'm-a',
    })
    expect(rows[0]).toEqual({
      id: 'b-1',
      marketId: 'm-a',
      marketName: 'Mercado A',
      day: '2026-10-25',
      supplierId: 'u-ana',
      supplierName: 'Sabor da Serra',
    })
    expect(rows[1]).toMatchObject({ marketName: '', supplierName: '' })
    expect(calls).toContainEqual(['lte', 'day', '2026-11-21'])
    expect(calls).toContainEqual(['eq', 'market_id', 'm-a'])
  })

  it('adminBookings sem filtro de fim nem de mercado', async () => {
    const { gateway, calls } = fakeClient(ok([]))
    await gateway.adminBookings({ from: '2026-10-21' })
    expect(calls.some(([method]) => method === 'lte')).toBe(false)
    expect(calls.some(([method]) => method === 'eq')).toBe(false)
    // Sem `limit` o pedido não limita nada de propósito (o teto é do servidor).
    expect(calls.some(([method]) => method === 'limit')).toBe(false)
  })

  it('adminBookings com limite pede só as primeiras linhas', async () => {
    const { gateway, calls } = fakeClient(ok([]))
    await gateway.adminBookings({ from: '2026-10-21', limit: 8 })
    expect(calls).toContainEqual(['limit', 8])
  })

  it('closedDays devolve dia e motivo', async () => {
    const { gateway } = fakeClient(ok([{ day: '2026-11-02', reason: 'Finados' }]))
    expect(await gateway.closedDays('m-a', '2026-11-01', '2026-11-30')).toEqual([
      { day: '2026-11-02', reason: 'Finados' },
    ])
  })
})

describe('escritas do administrador', () => {
  it('createMarket insere e devolve o mercado', async () => {
    const { gateway, calls } = fakeClient(ok(marketRow))
    const market = await gateway.createMarket({ name: 'Mercado A', address: null, capacity: 3 })
    expect(market.id).toBe('m-a')
    expect(calls).toContainEqual(['insert', { name: 'Mercado A', address: null, capacity: 3 }])
  })

  it('updateMarket manda só o que mudou, e arquivar vira a data de agora', async () => {
    const { gateway, calls } = fakeClient(ok(marketRow))
    await gateway.updateMarket('m-a', { capacity: 5 })
    await gateway.updateMarket('m-a', { archived: true })
    await gateway.updateMarket('m-a', { archived: false, name: 'Novo', address: 'Rua 1' })
    const updates = calls.filter(([method]) => method === 'update').map(([, change]) => change)
    expect(updates[0]).toEqual({ capacity: 5 })
    expect(updates[1]).toEqual({ archived_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/) })
    expect(updates[2]).toEqual({ archived_at: null, name: 'Novo', address: 'Rua 1' })
  })

  it('closeDay insere; fechar de novo (duplicata) é sucesso', async () => {
    const first = fakeClient(ok(null))
    await first.gateway.closeDay('m-a', '2026-11-02', 'Finados')
    expect(first.calls).toContainEqual([
      'insert',
      { market_id: 'm-a', day: '2026-11-02', reason: 'Finados' },
    ])

    const again = fakeClient({ data: null, error: { message: 'dup', code: '23505' }, status: 409 })
    await expect(again.gateway.closeDay('m-a', '2026-11-02')).resolves.toBeUndefined()
    expect(again.calls).toContainEqual([
      'insert',
      { market_id: 'm-a', day: '2026-11-02', reason: null },
    ])
  })

  it('closeDay com outro erro falha', async () => {
    const { gateway } = fakeClient({
      data: null,
      error: { message: 'boom', code: '42501' },
      status: 403,
    })
    await expect(gateway.closeDay('m-a', '2026-11-02')).rejects.toMatchObject({ code: 'AUTH' })
  })

  it('openDay apaga o par mercado e dia', async () => {
    const { gateway, calls } = fakeClient(ok(null))
    await gateway.openDay('m-a', '2026-11-02')
    expect(calls).toContainEqual(['delete'])
    expect(calls).toContainEqual(['eq', 'market_id', 'm-a'])
    expect(calls).toContainEqual(['eq', 'day', '2026-11-02'])
  })

  it('openDay com erro falha', async () => {
    const { gateway } = fakeClient({ data: null, error: { message: 'boom' }, status: 500 })
    await expect(gateway.openDay('m-a', '2026-11-02')).rejects.toMatchObject({ code: 'SERVER' })
  })
})

describe('toFailure', () => {
  it('sem resposta é rede', () => {
    expect(toFailure({ message: 'Failed to fetch' }, 0).code).toBe('NETWORK')
  })

  it('401, 403 e erros de JWT são de sessão', () => {
    expect(toFailure({ message: 'x' }, 401).code).toBe('AUTH')
    expect(toFailure({ message: 'x' }, 403).code).toBe('AUTH')
    expect(toFailure({ message: 'JWT expired', code: 'PGRST301' }, 400).code).toBe('AUTH')
  })

  it('o resto é do servidor e guarda a causa', () => {
    const failure = toFailure({ message: 'boom', code: 'XX000' }, 500)
    expect(failure.code).toBe('SERVER')
    expect(failure.cause).toEqual({ message: 'boom', code: 'XX000' })
  })
})
