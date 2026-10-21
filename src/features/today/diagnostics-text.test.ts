import { describe, expect, it } from 'vitest'
import type { SyncState } from '@/lib/offline/sync-engine'
import { buildDiagnostics, type DiagnosticsInput } from './diagnostics-text'

const base: DiagnosticsInput = {
  version: '0.0.0+abc1234',
  deviceId: 'device-1',
  unsent: 2,
  sync: { phase: 'idle' },
  lastSyncAt: '2026-10-21T13:32:00.000Z',
  fetchedAt: '2026-10-21T13:30:00.000Z',
  clockOffsetMs: 5_400,
}

describe('buildDiagnostics', () => {
  it('traz o que o suporte pergunta, em texto puro', () => {
    expect(buildDiagnostics(base)).toBe(
      [
        'Versão do app: 0.0.0+abc1234',
        'Aparelho: device-1',
        'Registros por enviar: 2',
        'Envio: em dia',
        'Último envio: 2026-10-21T13:32:00.000Z',
        'Lista lida do servidor em: 2026-10-21T13:30:00.000Z',
        'Relógio do aparelho: 5 s (positivo = relógio do aparelho atrasado)',
      ].join('\n'),
    )
  })

  it('nunca enviou e nunca mediu o relógio', () => {
    const text = buildDiagnostics({
      ...base,
      lastSyncAt: null,
      fetchedAt: null,
      clockOffsetMs: null,
    })
    expect(text).toContain('Último envio: nunca')
    expect(text).toContain('Lista lida do servidor em: nunca')
    expect(text).toContain('Relógio do aparelho: nunca medido')
  })

  it.each<[SyncState, string]>([
    [{ phase: 'syncing' }, 'Envio: enviando'],
    [
      { phase: 'waiting', reason: 'NETWORK', retryAt: '2026-10-21T13:35:00.000Z', attempt: 3 },
      'Envio: esperando (NETWORK, tentativa 3, de novo às 10:35)',
    ],
    [{ phase: 'auth_required' }, 'Envio: sessão vencida'],
    [
      { phase: 'upgrade_required', minClientVersion: '2.0.0' },
      'Envio: app velho demais (mínimo 2.0.0)',
    ],
    [
      { phase: 'blocked', reason: 'BAD_REQUEST', error: new Error('lote grande demais') },
      'Envio: parado (BAD_REQUEST): lote grande demais',
    ],
  ])('descreve o estado do envio: %o', (sync, expected) => {
    expect(buildDiagnostics({ ...base, sync })).toContain(expected)
  })
})
