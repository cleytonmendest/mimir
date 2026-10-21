import { describe, expect, it } from 'vitest'
import type { SyncState } from '@/lib/offline/sync-engine'
import { summarizeSync } from './sync-summary'

const LAST = '2026-10-21T13:32:00.000Z' // 10:32 em Brasília
const RETRY = '2026-10-21T13:35:00.000Z' // 10:35 em Brasília

function summary(state: SyncState, unsent = 0, lastSyncAt: string | null = null) {
  return summarizeSync({ state, unsent, lastSyncAt })
}

describe('summarizeSync', () => {
  it('nada a enviar: tudo certo, com a hora do último envio', () => {
    expect(summary({ phase: 'idle' }, 0, LAST)).toEqual({
      tone: 'ok',
      title: 'Tudo enviado',
      detail: 'Último envio às 10:32.',
    })
  })

  it('nada a enviar e nunca enviou: só "tudo enviado"', () => {
    expect(summary({ phase: 'idle' })).toEqual({ tone: 'ok', title: 'Tudo enviado' })
  })

  it('parado com registros na fila: diz quantos, no singular e no plural', () => {
    expect(summary({ phase: 'idle' }, 1)).toMatchObject({
      tone: 'waiting',
      title: '1 registro para enviar',
      action: 'syncNow',
    })
    expect(summary({ phase: 'idle' }, 4).title).toBe('4 registros para enviar')
  })

  it('enviando', () => {
    expect(summary({ phase: 'syncing' }, 2)).toEqual({ tone: 'working', title: 'Enviando…' })
  })

  it('sem sinal: diz que está guardado, quando tenta de novo e deixa tentar agora', () => {
    const waiting: SyncState = { phase: 'waiting', reason: 'NETWORK', retryAt: RETRY, attempt: 2 }
    expect(summary(waiting, 3)).toEqual({
      tone: 'waiting',
      title: '3 registros para enviar',
      detail: 'Sem conexão. Tentando de novo às 10:35.',
      action: 'syncNow',
    })
    expect(summary(waiting, 0).title).toBe('Sem conexão com o servidor')
  })

  it('sessão vencida: pede para entrar de novo e garante que o trabalho está guardado', () => {
    expect(summary({ phase: 'auth_required' }, 2)).toEqual({
      tone: 'problem',
      title: 'Entre de novo para enviar',
      detail: 'Seus 2 registros estão guardados neste aparelho.',
    })
    expect(summary({ phase: 'auth_required' }, 0)).toEqual({
      tone: 'problem',
      title: 'Entre de novo para enviar',
    })
  })

  it('app velho demais', () => {
    expect(summary({ phase: 'upgrade_required', minClientVersion: '2.0.0' }, 1)).toEqual({
      tone: 'problem',
      title: 'Atualize o app para enviar',
      detail: 'Seu registro está guardado neste aparelho. Tudo será enviado depois da atualização.',
    })
  })

  it('bloqueado: manda olhar os detalhes e deixa tentar de novo', () => {
    const blocked: SyncState = { phase: 'blocked', reason: 'BAD_REQUEST', error: new Error('x') }
    expect(summary(blocked, 2)).toMatchObject({
      tone: 'problem',
      title: 'Não foi possível enviar',
      action: 'syncNow',
    })
    expect(summary(blocked, 0).detail).toBe('Informe os detalhes abaixo ao suporte.')
  })
})
