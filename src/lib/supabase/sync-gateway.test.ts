import { describe, expect, it } from 'vitest'
import type { OfflineEvent } from '@/domain/sync'
import type { AppSupabaseClient } from './client'
import { ConfigError, SyncFailure } from './errors'
import { createSyncGateway, MAX_SYNC_BATCH } from './sync-gateway'

const DEVICE = '00000000-0000-0000-0000-00000000d001'

const checkIn: OfflineEvent = {
  clientEventId: 'e-1',
  seq: 1,
  visitId: 'v-1',
  occurredAt: '2026-10-21T12:00:00.000Z',
  type: 'checkIn',
}

const okBody = {
  server_now: '2026-10-21T15:00:00.000+00:00',
  results: [
    {
      client_event_id: 'e-1',
      visit_id: 'v-1',
      status: 'applied',
      code: null,
      visit_status: 'in_progress',
      duplicate: false,
    },
  ],
  visits: [],
}

interface Reply {
  data: unknown
  error: { message: string; code?: string } | null
  status: number
}

/** Um cliente de mentira que registra o que o gateway chamou. */
function fakeClient(reply: Reply) {
  const calls: { name: string; args: unknown; signal: AbortSignal | undefined }[] = []
  const client = {
    rpc: (name: string, args: unknown) => ({
      abortSignal: (signal: AbortSignal) => {
        calls.push({ name, args, signal })
        return Promise.resolve(reply)
      },
    }),
  } as unknown as AppSupabaseClient
  return { client, calls }
}

function gatewayWith(reply: Reply, options = {}) {
  const fake = fakeClient(reply)
  const gateway = createSyncGateway(() => fake.client, { clientVersion: '1.2.3+abc1234', ...options })
  return { gateway, calls: fake.calls }
}

const OK: Reply = { data: okBody, error: null, status: 200 }

describe('createSyncGateway', () => {
  it('chama a função versionada com o aparelho, a versão do app e os eventos', async () => {
    const { gateway, calls } = gatewayWith(OK)

    const response = await gateway.sync({ deviceId: DEVICE, events: [checkIn] })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.name).toBe('sync_visit_events_v1')
    expect(calls[0]?.args).toEqual({
      p_device_id: DEVICE,
      p_client_version: '1.2.3+abc1234',
      p_events: [
        {
          client_event_id: 'e-1',
          seq: 1,
          visit_id: 'v-1',
          type: 'checkIn',
          occurred_at: '2026-10-21T12:00:00.000Z',
        },
      ],
    })
    expect(response).toMatchObject({ kind: 'synced', results: [{ clientEventId: 'e-1' }] })
  })

  it('usa a versão do app definida no build quando ninguém a informa', async () => {
    const fake = fakeClient(OK)
    await createSyncGateway(() => fake.client).sync({ deviceId: DEVICE, events: [] })
    expect((fake.calls[0]?.args as { p_client_version: string }).p_client_version).toMatch(
      /^\d+\.\d+\.\d+\+\w+$/,
    )
  })

  it('o envio tem prazo: um sinal que "pendura" não prende a fila para sempre', async () => {
    const { gateway, calls } = gatewayWith(OK, { timeoutMs: 5_000 })

    await gateway.sync({ deviceId: DEVICE, events: [] })

    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal)
    expect(calls[0]?.signal?.aborted).toBe(false)
  })

  it('"atualize o app" não é falha: a resposta diz qual versão basta', async () => {
    const { gateway } = gatewayWith({
      data: { upgrade_required: true, min_client_version: '2.0.0', server_now: okBody.server_now },
      error: null,
      status: 200,
    })

    await expect(gateway.sync({ deviceId: DEVICE, events: [checkIn] })).resolves.toMatchObject({
      kind: 'upgrade_required',
      minClientVersion: '2.0.0',
    })
  })

  it('recusa de evento não é falha de transporte: vem nos resultados', async () => {
    const { gateway } = gatewayWith({
      data: {
        ...okBody,
        results: [{ ...okBody.results[0], status: 'rejected', code: 'FORBIDDEN' }],
      },
      error: null,
      status: 200,
    })

    const response = await gateway.sync({ deviceId: DEVICE, events: [checkIn] })

    expect(response.kind === 'synced' && response.results[0]).toMatchObject({
      status: 'rejected',
      code: 'FORBIDDEN',
    })
  })

  it('lote acima do limite do servidor nem sai do aparelho', async () => {
    const { gateway, calls } = gatewayWith(OK)
    const events = Array.from({ length: MAX_SYNC_BATCH + 1 }, (_, index) => ({
      ...checkIn,
      clientEventId: `e-${index}`,
      seq: index,
    }))

    await expect(gateway.sync({ deviceId: DEVICE, events })).rejects.toMatchObject({
      code: 'BAD_REQUEST',
    })
    expect(calls).toHaveLength(0)
  })

  it('o limite de eventos por lote cabe exatamente', async () => {
    const { gateway } = gatewayWith(OK)
    const events = Array.from({ length: MAX_SYNC_BATCH }, (_, index) => ({
      ...checkIn,
      clientEventId: `e-${index}`,
      seq: index,
    }))
    await expect(gateway.sync({ deviceId: DEVICE, events })).resolves.toMatchObject({
      kind: 'synced',
    })
  })

  it('sem configuração do Supabase falha como erro de configuração', async () => {
    const gateway = createSyncGateway(
      () => {
        throw new ConfigError('faltam as variáveis')
      },
      { clientVersion: '1.0.0' },
    )
    await expect(gateway.sync({ deviceId: DEVICE, events: [] })).rejects.toBeInstanceOf(ConfigError)
  })

  it('resposta que o app não entende falha como resposta inválida', async () => {
    const { gateway } = gatewayWith({ data: { server_now: 'ontem' }, error: null, status: 200 })
    await expect(gateway.sync({ deviceId: DEVICE, events: [] })).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })

  describe('classifica a falha para o motor saber o que fazer', () => {
    const fail = (status: number, code = '', message = 'boom'): Reply => ({
      data: null,
      error: { message, code },
      status,
    })

    it.each([
      ['sem rede (o fetch nem completou)', fail(0, '', 'TypeError: Failed to fetch'), 'NETWORK'],
      ['prazo estourado', fail(0, '', 'AbortError: signal timed out'), 'NETWORK'],
      ['sessão expirada', fail(401, 'PGRST301', 'JWT expired'), 'AUTH'],
      ['token inválido sem status útil', fail(400, 'PGRST303', 'JWT invalid'), 'AUTH'],
      ['sem usuário na sessão', fail(403, '42501', 'sessão ausente'), 'AUTH'],
      ['servidor com defeito', fail(500, 'XX000', 'internal'), 'SERVER'],
      ['servidor fora do ar', fail(503), 'SERVER'],
      ['função ainda não implantada', fail(404, 'PGRST202', 'Could not find the function'), 'SERVER'],
      ['pediram para esperar', fail(429), 'SERVER'],
      ['servidor demorou', fail(408), 'SERVER'],
      // O PostgREST responde 500 a este código; só o código diz que repetir não adianta.
      ['lote grande demais', fail(500, '54000', 'no máximo 50 eventos por envio'), 'BAD_REQUEST'],
      ['parâmetro inválido', fail(400, '22023', 'events precisa ser uma lista'), 'BAD_REQUEST'],
      ['versão mal formada', fail(400, '22P02', 'invalid input syntax'), 'BAD_REQUEST'],
    ])('%s', async (_name, reply, code) => {
      const { gateway } = gatewayWith(reply)

      const failure: unknown = await gateway
        .sync({ deviceId: DEVICE, events: [checkIn] })
        .catch((error: unknown) => error)

      expect(failure).toBeInstanceOf(SyncFailure)
      expect(failure).toMatchObject({ code })
      expect((failure as SyncFailure).cause).toMatchObject({ message: reply.error?.message })
    })
  })
})
