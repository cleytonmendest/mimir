import { describe, expect, it } from 'vitest'
import type { OfflineEvent } from '@/domain/sync'
import { SyncFailure } from './errors'
import { parseSyncResponse, toWireEvent } from './sync-wire'

const NOW = '2026-10-21T15:00:00.123456+00:00'

const visitJson = {
  id: 'v-1',
  repositor_id: 'u-ana',
  market_id: 'm-a',
  visit_date: '2026-10-21',
  position: 2,
  status: 'done',
  origin: 'standard',
  carried_from_date: null,
  check_in_at: '2026-10-21T12:00:00+00:00',
  check_out_at: '2026-10-21T12:40:00+00:00',
  note: 'Tudo certo',
  skip_reason: null,
  created_at: '2026-10-20T09:00:00+00:00',
  updated_at: '2026-10-21T12:40:00+00:00',
}

const resultJson = {
  client_event_id: 'e-1',
  visit_id: 'v-1',
  status: 'applied',
  code: null,
  visit_status: 'in_progress',
  duplicate: false,
}

function response(overrides: Record<string, unknown> = {}) {
  return { server_now: NOW, results: [resultJson], visits: [visitJson], ...overrides }
}

function failureOf(run: () => unknown): SyncFailure {
  try {
    run()
  } catch (error) {
    if (error instanceof SyncFailure) return error
    throw error
  }
  throw new Error('não falhou')
}

describe('toWireEvent', () => {
  const base = { clientEventId: 'e-1', seq: 3, visitId: 'v-1', occurredAt: '2026-10-21T12:00:00.000Z' }

  it('check-in leva só o que o servidor lê', () => {
    expect(toWireEvent({ ...base, type: 'checkIn' })).toEqual({
      client_event_id: 'e-1',
      seq: 3,
      visit_id: 'v-1',
      type: 'checkIn',
      occurred_at: '2026-10-21T12:00:00.000Z',
    })
  })

  it('check-out leva a observação, se houver', () => {
    expect(toWireEvent({ ...base, type: 'checkOut', note: 'Ok' })).toMatchObject({ note: 'Ok' })
    expect(toWireEvent({ ...base, type: 'checkOut' })).not.toHaveProperty('note')
  })

  it('"não fui" leva o motivo', () => {
    expect(toWireEvent({ ...base, type: 'markNotDone', reason: 'Fechado' })).toMatchObject({
      type: 'markNotDone',
      reason: 'Fechado',
    })
  })

  it('o evento derivado diz qual evento o causou', () => {
    const event: OfflineEvent = { ...base, type: 'checkOut', causedBy: 'e-0' }
    expect(toWireEvent(event)).toMatchObject({ caused_by: 'e-0' })
  })
})

describe('parseSyncResponse', () => {
  it('entende a resposta de um lote: resultados e visitas do domínio', () => {
    const parsed = parseSyncResponse(response())

    expect(parsed).toEqual({
      kind: 'synced',
      serverNow: '2026-10-21T15:00:00.123Z',
      results: [
        {
          clientEventId: 'e-1',
          visitId: 'v-1',
          status: 'applied',
          code: null,
          visitStatus: 'in_progress',
          duplicate: false,
        },
      ],
      visits: [
        {
          id: 'v-1',
          repositorId: 'u-ana',
          marketId: 'm-a',
          date: '2026-10-21',
          order: 2,
          status: 'done',
          origin: 'standard',
          carriedFromDate: null,
          checkInAt: '2026-10-21T12:00:00.000Z',
          checkOutAt: '2026-10-21T12:40:00.000Z',
          note: 'Tudo certo',
          skipReason: null,
        },
      ],
    })
  })

  it('reenvio vem marcado como repetido', () => {
    const parsed = parseSyncResponse(response({ results: [{ ...resultJson, duplicate: true }] }))
    expect(parsed.kind === 'synced' && parsed.results[0]?.duplicate).toBe(true)
  })

  it('recusa traz o motivo e o estado atual da visita', () => {
    const parsed = parseSyncResponse(
      response({
        results: [
          { ...resultJson, status: 'rejected', code: 'INVALID_TRANSITION', visit_status: 'cancelled' },
        ],
      }),
    )
    expect(parsed.kind === 'synced' && parsed.results[0]).toMatchObject({
      status: 'rejected',
      code: 'INVALID_TRANSITION',
      visitStatus: 'cancelled',
    })
  })

  it('motivo que este app não conhece não derruba o envio', () => {
    const parsed = parseSyncResponse(
      response({ results: [{ ...resultJson, status: 'rejected', code: 'ALGO_NOVO' }] }),
    )
    expect(parsed.kind === 'synced' && parsed.results[0]?.code).toBe('UNRECOGNIZED')
  })

  it('recusa sem motivo também vira "não reconhecido"', () => {
    const parsed = parseSyncResponse(response({ results: [{ ...resultJson, status: 'rejected' }] }))
    expect(parsed.kind === 'synced' && parsed.results[0]?.code).toBe('UNRECOGNIZED')
  })

  it('estado de visita que este app não conhece vira "sem estado"', () => {
    const parsed = parseSyncResponse(
      response({ results: [{ ...resultJson, visit_status: 'em_revisao' }] }),
    )
    expect(parsed.kind === 'synced' && parsed.results[0]?.visitStatus).toBeNull()
  })

  it('evento sem visita (dado ilegível) vem com visitId nulo', () => {
    const parsed = parseSyncResponse(
      response({
        results: [{ ...resultJson, visit_id: null, status: 'rejected', code: 'INVALID_DATA' }],
      }),
    )
    expect(parsed.kind === 'synced' && parsed.results[0]?.visitId).toBeNull()
  })

  it('lote sem visitas tocadas', () => {
    expect(parseSyncResponse(response({ results: [], visits: [] }))).toMatchObject({
      kind: 'synced',
      results: [],
      visits: [],
    })
  })

  it('"atualize o app": nada foi processado', () => {
    expect(
      parseSyncResponse({
        upgrade_required: true,
        min_client_version: '2.0.0',
        server_now: NOW,
      }),
    ).toEqual({
      kind: 'upgrade_required',
      minClientVersion: '2.0.0',
      serverNow: '2026-10-21T15:00:00.123Z',
    })
  })

  describe('resposta que o app não entende falha de forma explicável', () => {
    it.each<[string, unknown]>([
      ['sem corpo', null],
      ['corpo que não é objeto', [1, 2]],
      ['sem server_now', { results: [], visits: [] }],
      ['server_now que não é data', response({ server_now: 'ontem' })],
      ['sem lista de resultados', response({ results: undefined })],
      ['resultado que não é objeto', response({ results: ['x'] })],
      ['resultado sem id', response({ results: [{ ...resultJson, client_event_id: 1 }] })],
      ['resultado com status desconhecido', response({ results: [{ ...resultJson, status: 'x' }] })],
      ['visita_id que não é texto', response({ results: [{ ...resultJson, visit_id: 7 }] })],
      ['visita sem posição', response({ visits: [{ ...visitJson, position: 'a' }] })],
      ['visita com posição fracionada', response({ visits: [{ ...visitJson, position: 1.5 }] })],
      ['visita com status desconhecido', response({ visits: [{ ...visitJson, status: 'x' }] })],
      ['visita com origem desconhecida', response({ visits: [{ ...visitJson, origin: 'x' }] })],
      ['visita com horário que não é texto', response({ visits: [{ ...visitJson, check_in_at: 5 }] })],
      ['upgrade sem a versão mínima', { upgrade_required: true, server_now: NOW }],
    ])('%s', (_name, data) => {
      const failure = failureOf(() => parseSyncResponse(data as never))
      expect(failure.code).toBe('INVALID_RESPONSE')
    })
  })
})
