import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncGateway } from '@/lib/supabase/sync-gateway'
import { createOfflineRuntime } from './runtime'
import * as store from './store'

beforeEach(() => {
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
})

function gatewayWithCalls() {
  const calls: number[] = []
  const gateway: SyncGateway = {
    sync: ({ events }) => {
      calls.push(events.length)
      return Promise.resolve({
        kind: 'synced',
        serverNow: '2026-10-21T15:00:00.000Z',
        results: events.map((event) => ({
          clientEventId: event.clientEventId,
          visitId: event.visitId,
          status: 'applied' as const,
          code: null,
          visitStatus: null,
          duplicate: false,
        })),
        visits: [],
      })
    },
  }
  return { gateway, calls }
}

describe('createOfflineRuntime', () => {
  it('abre a sessão de um usuário com fila, motor e o mesmo deviceId do aparelho', async () => {
    const { gateway } = gatewayWithCalls()
    const runtime = await createOfflineRuntime(gateway)

    const ana = await runtime.openUser('u-ana')
    const bruno = await runtime.openUser('u-bruno')

    expect(ana.deviceId).toBe(await runtime.device.deviceId())
    expect(bruno.deviceId).toBe(ana.deviceId)
    await ana.store.enqueue([
      { type: 'checkIn', visitId: 'v-a', occurredAt: '2026-10-21T12:00:00.000Z' },
    ])
    expect(await ana.store.pending()).toHaveLength(1)
    expect(await bruno.store.pending()).toHaveLength(0)
  })

  it('o motor da sessão envia a fila do usuário', async () => {
    const { gateway, calls } = gatewayWithCalls()
    const runtime = await createOfflineRuntime(gateway)
    const session = await runtime.openUser('u-ana')
    await session.store.enqueue([
      { type: 'checkIn', visitId: 'v-a', occurredAt: '2026-10-21T12:00:00.000Z' },
    ])

    expect(await session.engine.sync()).toEqual({ phase: 'idle' })

    expect(calls).toEqual([1])
    expect(await session.store.pending()).toEqual([])
  })

  it('o sinal que volta dispara o envio, e fechar a sessão desliga isso', async () => {
    const { gateway, calls } = gatewayWithCalls()
    const runtime = await createOfflineRuntime(gateway)
    const session = await runtime.openUser('u-ana')
    await session.store.enqueue([
      { type: 'checkIn', visitId: 'v-a', occurredAt: '2026-10-21T12:00:00.000Z' },
    ])

    window.dispatchEvent(new Event('online'))
    await vi.waitFor(() => expect(calls).toEqual([1]))

    session.close()
    await session.engine.sync().catch(() => undefined)
    window.dispatchEvent(new Event('online'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toEqual([1])
  })

  it('se não der para ler o deviceId, o banco do usuário é fechado em vez de vazar', async () => {
    const { gateway } = gatewayWithCalls()
    const runtime = await createOfflineRuntime(gateway)
    vi.spyOn(runtime.device, 'deviceId').mockRejectedValueOnce(new Error('banco do aparelho caiu'))

    await expect(runtime.openUser('u-ana')).rejects.toThrow('banco do aparelho caiu')

    // O banco do usuário foi fechado: apagá-lo não fica esperando ninguém soltá-lo.
    await expect(store.deleteUserStore('u-ana')).resolves.toBeUndefined()
  })

  it('navegador sem armazenamento: falha com erro explicável', async () => {
    const { gateway } = gatewayWithCalls()
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB

    await expect(createOfflineRuntime(gateway)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })
})
