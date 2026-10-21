import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EventDraft } from '@/domain/execution'
import { makeVisit } from '@/domain/testing'
import type { Visit } from '@/domain/types'
import { SyncFailure } from '@/lib/supabase/errors'
import type { SyncGateway } from '@/lib/supabase/sync-gateway'
import type { EventResult, SyncResponse } from '@/lib/supabase/sync-wire'
import { openUserStore, type Snapshot, type UserStore } from './store'
import { createSyncEngine, retryDelayMs, type SyncState } from './sync-engine'
import { attachSyncTriggers } from './sync-triggers'

const NOW = '2026-10-21T15:00:00.000Z'

beforeEach(() => {
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
})

const draft = (visitId: string, type: 'checkIn' | 'checkOut' = 'checkIn'): EventDraft =>
  type === 'checkIn'
    ? { type, visitId, occurredAt: '2026-10-21T12:00:00.000Z' }
    : { type, visitId, occurredAt: '2026-10-21T12:40:00.000Z' }

function applied(clientEventId: string): EventResult {
  return {
    clientEventId,
    visitId: null,
    status: 'applied',
    code: null,
    visitStatus: null,
    duplicate: false,
  }
}

function synced(results: EventResult[], visits: Visit[] = []): SyncResponse {
  return { kind: 'synced', serverNow: '2026-10-21T15:00:05.000Z', results, visits }
}

/** Um servidor de mentira que responde o que o teste mandar, na ordem. */
function scriptedGateway(...script: (SyncResponse | SyncFailure | Error)[]) {
  const calls: string[][] = []
  const gateway: SyncGateway = {
    sync: ({ events }) => {
      calls.push(events.map((event) => event.clientEventId))
      const next = script.shift()
      if (next === undefined) throw new Error('o roteiro acabou')
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next)
    },
  }
  return { gateway, calls }
}

/** Relógio de espera controlado pelo teste. */
function manualClock() {
  const timers: { callback: () => void; ms: number; cancelled: boolean }[] = []
  return {
    schedule: (callback: () => void, ms: number) => {
      const timer = { callback, ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    },
    waiting: () => timers.filter((timer) => !timer.cancelled),
    delays: () => timers.map((timer) => timer.ms),
    fire: async () => {
      const timer = timers.filter((candidate) => !candidate.cancelled).at(-1)
      if (timer === undefined) throw new Error('não há espera agendada')
      timer.cancelled = true
      timer.callback()
      await Promise.resolve()
    },
  }
}

async function setup(
  script: Parameters<typeof scriptedGateway>,
  options: { batchSize?: number } = {},
) {
  const store = await openUserStore('u-ana', { now: () => NOW, newId: sequentialIds() })
  const server = scriptedGateway(...script)
  const clock = manualClock()
  const engine = createSyncEngine({
    store,
    gateway: server.gateway,
    deviceId: 'device-1',
    now: () => NOW,
    schedule: clock.schedule,
    random: () => 0.5,
    ...options,
  })
  return { store, engine, clock, ...server }
}

function sequentialIds() {
  let counter = 0
  return () => `e-${++counter}`
}

async function pendingIds(store: UserStore): Promise<string[]> {
  return (await store.pending()).map((event) => event.clientEventId)
}

describe('retryDelayMs', () => {
  it('dobra a cada tentativa, de 2 s até 5 min', () => {
    const half = () => 0.5
    expect([1, 2, 3, 4, 5, 9, 10, 20].map((attempt) => retryDelayMs(attempt, half))).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000, 300_000, 300_000, 300_000,
    ])
  })

  it('varia ±20% para vários aparelhos não baterem no servidor juntos', () => {
    expect(retryDelayMs(3, () => 0)).toBe(6_400)
    expect(retryDelayMs(3, () => 1)).toBe(9_600)
  })
})

describe('a espera padrão', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('sem um agendador de teste, usa o relógio de verdade e dá para cancelar', async () => {
    // Só setTimeout é falso: o IndexedDB de teste depende de setImmediate e travaria.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const store = await openUserStore('u-ana', { now: () => NOW, newId: sequentialIds() })
    const first = scriptedGateway(new SyncFailure('NETWORK', 'sem sinal'), synced([applied('e-1')]))
    const engine = createSyncEngine({
      store,
      gateway: first.gateway,
      deviceId: 'd',
      now: () => NOW,
    })
    await store.enqueue([draft('v-a')])

    expect(await engine.sync()).toMatchObject({ phase: 'waiting', attempt: 1 })
    await vi.advanceTimersByTimeAsync(10_000)
    await vi.waitFor(() => expect(engine.state()).toEqual({ phase: 'idle' }))

    await store.enqueue([draft('v-b')])
    const second = scriptedGateway(new SyncFailure('NETWORK', 'de novo'))
    const other = createSyncEngine({
      store,
      gateway: second.gateway,
      deviceId: 'd',
      now: () => NOW,
    })
    await other.sync()
    other.stop()
    await vi.advanceTimersByTimeAsync(10 * 60_000)

    expect(second.calls).toHaveLength(1)
  })
})

describe('enviando a fila', () => {
  it('fila vazia: não chama o servidor', async () => {
    const { engine, calls } = await setup([])

    expect(await engine.sync()).toEqual({ phase: 'idle' })
    expect(calls).toEqual([])
  })

  it('envia em lotes, na ordem, e aplica cada resposta antes do lote seguinte', async () => {
    const { store, engine, calls } = await setup(
      [synced([applied('e-1'), applied('e-2')]), synced([applied('e-3')])],
      { batchSize: 2 },
    )
    await store.enqueue([draft('v-a')])
    await store.enqueue([draft('v-a', 'checkOut')])
    await store.enqueue([draft('v-b')])

    expect(await engine.sync()).toEqual({ phase: 'idle' })

    expect(calls).toEqual([['e-1', 'e-2'], ['e-3']])
    expect(await pendingIds(store)).toEqual([])
  })

  it('atualiza a cópia com as visitas que o servidor devolveu, junto de tirar da fila', async () => {
    const visit = makeVisit({ id: 'v-a', date: '2026-10-21' })
    const done = { ...visit, status: 'done' as const, checkInAt: NOW, checkOutAt: NOW }
    const { store, engine } = await setup([synced([applied('e-1')], [done])])
    const snapshot: Snapshot = { visits: [visit], markets: [], route: [], fetchedAt: NOW }
    await store.saveSnapshot(snapshot)
    await store.enqueue([draft('v-a')])

    await engine.sync()

    const view = await store.read()
    expect(view.snapshot?.visits).toEqual([done])
    expect(view.pending).toEqual([])
    expect(view.clockOffsetMs).toBe(5_000)
  })

  it('recusados saem da fila e ficam guardados com o motivo', async () => {
    const refused: EventResult = {
      ...applied('e-1'),
      status: 'rejected',
      code: 'INVALID_TRANSITION',
      visitStatus: 'cancelled',
    }
    const unknown: EventResult = { ...applied('e-2'), status: 'rejected', code: null }
    const { store, engine } = await setup([synced([refused, unknown])])
    await store.enqueue([draft('v-a')])
    await store.enqueue([draft('v-b')])

    await engine.sync()

    const view = await store.read()
    expect(view.pending).toEqual([])
    expect(
      view.rejected.map((item) => [
        item.event.clientEventId,
        item.rejection.code,
        item.rejection.visitStatus,
      ]),
    ).toEqual([
      ['e-1', 'INVALID_TRANSITION', 'cancelled'],
      ['e-2', 'UNRECOGNIZED', null],
    ])
  })

  it('ignora resultado de evento que não estava no lote', async () => {
    const { store, engine } = await setup([synced([applied('e-1'), applied('e-intruso')])])
    await store.enqueue([draft('v-a')])

    await engine.sync()

    expect(await pendingIds(store)).toEqual([])
  })
})

describe('quando falha', () => {
  it('sem rede: espera e tenta sozinho de novo, e a fila fica intacta', async () => {
    const { store, engine, clock, calls } = await setup([
      new SyncFailure('NETWORK', 'sem sinal'),
      synced([applied('e-1')]),
    ])
    await store.enqueue([draft('v-a')])

    const state = await engine.sync()

    expect(state).toEqual({
      phase: 'waiting',
      reason: 'NETWORK',
      retryAt: '2026-10-21T15:00:02.000Z',
      attempt: 1,
    })
    expect(await pendingIds(store)).toEqual(['e-1'])
    expect(clock.delays()).toEqual([2_000])

    await clock.fire()
    await vi.waitFor(() => expect(engine.state()).toEqual({ phase: 'idle' }))
    expect(calls).toEqual([['e-1'], ['e-1']])
    expect(await pendingIds(store)).toEqual([])
  })

  it('falhas seguidas esperam cada vez mais; um sucesso zera a conta', async () => {
    const { store, engine, clock } = await setup([
      new SyncFailure('NETWORK', 'a'),
      new SyncFailure('SERVER', 'b'),
      new SyncFailure('NETWORK', 'c'),
      synced([applied('e-1')]),
      new SyncFailure('NETWORK', 'd'),
    ])
    await store.enqueue([draft('v-a')])

    await engine.sync()
    await clock.fire()
    await vi.waitFor(() => expect(engine.state()).toMatchObject({ attempt: 2 }))
    await clock.fire()
    await vi.waitFor(() => expect(engine.state()).toMatchObject({ attempt: 3 }))
    await clock.fire()
    await vi.waitFor(() => expect(engine.state()).toEqual({ phase: 'idle' }))
    expect(clock.delays()).toEqual([2_000, 4_000, 8_000])

    await store.enqueue([draft('v-b')])
    await engine.sync()
    expect(engine.state()).toMatchObject({ phase: 'waiting', attempt: 1 })
    expect(clock.delays().at(-1)).toBe(2_000)
  })

  it('"tentar agora" cancela a espera e envia na hora', async () => {
    const { store, engine, clock } = await setup([
      new SyncFailure('NETWORK', 'sem sinal'),
      synced([applied('e-1')]),
    ])
    await store.enqueue([draft('v-a')])
    await engine.sync()
    expect(clock.waiting()).toHaveLength(1)

    expect(await engine.sync()).toEqual({ phase: 'idle' })

    expect(clock.waiting()).toHaveLength(0)
  })

  it('lote que falha no meio: o que já foi aplicado fica aplicado, o resto espera', async () => {
    const { store, engine } = await setup(
      [synced([applied('e-1'), applied('e-2')]), new SyncFailure('NETWORK', 'caiu')],
      { batchSize: 2 },
    )
    for (const id of ['v-a', 'v-b', 'v-c']) await store.enqueue([draft(id)])

    await engine.sync()

    expect(engine.state()).toMatchObject({ phase: 'waiting', attempt: 1 })
    expect(await pendingIds(store)).toEqual(['e-3'])
  })

  it('sessão vencida: para e só volta quando o app avisa', async () => {
    const { store, engine, clock, calls } = await setup([
      new SyncFailure('AUTH', 'jwt expired'),
      synced([applied('e-1')]),
    ])
    await store.enqueue([draft('v-a')])

    expect(await engine.sync()).toEqual({ phase: 'auth_required' })
    expect(clock.waiting()).toHaveLength(0)
    expect(await pendingIds(store)).toEqual(['e-1'])

    expect(await engine.resume()).toEqual({ phase: 'idle' })
    expect(calls).toHaveLength(2)
  })

  it('app velho demais: avisa e guarda a fila', async () => {
    const { store, engine } = await setup([
      { kind: 'upgrade_required', minClientVersion: '2.0.0', serverNow: NOW },
    ])
    await store.enqueue([draft('v-a')])

    expect(await engine.sync()).toEqual({ phase: 'upgrade_required', minClientVersion: '2.0.0' })
    expect(await pendingIds(store)).toEqual(['e-1'])
  })

  it.each(['BAD_REQUEST', 'INVALID_RESPONSE'] as const)(
    '%s: bloqueia em vez de repetir à toa',
    async (code) => {
      const failure = new SyncFailure(code, 'não adianta')
      const { store, engine, clock } = await setup([failure, synced([applied('e-1')])])
      await store.enqueue([draft('v-a')])

      expect(await engine.sync()).toEqual({ phase: 'blocked', reason: code, error: failure })
      expect(clock.waiting()).toHaveLength(0)

      // O botão "enviar agora" sempre tenta.
      expect(await engine.sync()).toEqual({ phase: 'idle' })
    },
  )

  it('resposta que não decide nenhum evento do lote bloqueia (não gira em falso)', async () => {
    const { store, engine, calls } = await setup([synced([])])
    await store.enqueue([draft('v-a')])

    const state = await engine.sync()

    expect(state).toMatchObject({ phase: 'blocked', reason: 'INVALID_RESPONSE' })
    expect(calls).toHaveLength(1)
  })

  it('falha inesperada (armazenamento, configuração) bloqueia e guarda o erro', async () => {
    const boom = new Error('cota cheia')
    const { store, engine } = await setup([synced([applied('e-1')])])
    await store.enqueue([draft('v-a')])
    vi.spyOn(store, 'ack').mockRejectedValueOnce(boom)

    expect(await engine.sync()).toEqual({ phase: 'blocked', reason: 'UNEXPECTED', error: boom })
    expect(await pendingIds(store)).toEqual(['e-1'])
  })

  it('erro que nem é Error também é guardado', async () => {
    const { store, engine } = await setup([])
    await store.enqueue([draft('v-a')])
    vi.spyOn(store, 'pending').mockRejectedValueOnce('texto solto')

    expect(await engine.sync()).toMatchObject({
      phase: 'blocked',
      reason: 'UNEXPECTED',
      error: new Error('texto solto'),
    })
  })
})

describe('um envio de cada vez', () => {
  it('pedidos juntos viram um envio só', async () => {
    const { store, engine, calls } = await setup([synced([applied('e-1')])])
    await store.enqueue([draft('v-a')])

    const [first, second] = await Promise.all([engine.sync(), engine.sync()])

    expect(first).toEqual({ phase: 'idle' })
    expect(second).toEqual({ phase: 'idle' })
    expect(calls).toEqual([['e-1']])
  })

  it('o que foi gravado durante um envio é pego no fim dele', async () => {
    const store = await openUserStore('u-ana', { now: () => NOW, newId: sequentialIds() })
    const release: (() => void)[] = []
    const calls: string[][] = []
    const gateway: SyncGateway = {
      sync: async ({ events }) => {
        calls.push(events.map((event) => event.clientEventId))
        if (calls.length === 1) await new Promise<void>((resolve) => release.push(resolve))
        return synced(events.map((event) => applied(event.clientEventId)))
      },
    }
    const engine = createSyncEngine({ store, gateway, deviceId: 'd', now: () => NOW })
    await store.enqueue([draft('v-a')])

    const running = engine.sync()
    await vi.waitFor(() => expect(release).toHaveLength(1))
    await store.enqueue([draft('v-b')])
    const extra = engine.sync()
    release[0]?.()
    await Promise.all([running, extra])

    expect(calls).toEqual([['e-1'], ['e-2']])
    expect(await pendingIds(store)).toEqual([])
  })

  it('a rodada extra cancela a espera da falha anterior e tenta já', async () => {
    const store = await openUserStore('u-ana', { now: () => NOW, newId: sequentialIds() })
    const clock = manualClock()
    const calls: number[] = []
    let hold: (() => void) | undefined
    const gateway: SyncGateway = {
      sync: async ({ events }) => {
        calls.push(events.length)
        if (calls.length === 1) {
          await new Promise<void>((resolve) => (hold = resolve))
          throw new SyncFailure('NETWORK', 'caiu')
        }
        return synced(events.map((event) => applied(event.clientEventId)))
      },
    }
    const engine = createSyncEngine({
      store,
      gateway,
      deviceId: 'd',
      now: () => NOW,
      schedule: clock.schedule,
    })
    await store.enqueue([draft('v-a')])

    const running = engine.sync()
    await vi.waitFor(() => expect(hold).toBeDefined())
    const extra = engine.sync()
    hold?.()
    await Promise.all([running, extra])

    expect(engine.state()).toEqual({ phase: 'idle' })
    expect(clock.waiting()).toHaveLength(0)
    expect(calls).toHaveLength(2)
  })
})

describe('avisos de estado', () => {
  it('avisa cada mudança, e para de avisar depois de cancelar', async () => {
    const { store, engine } = await setup([synced([applied('e-1')]), synced([applied('e-2')])])
    const seen: string[] = []
    const unsubscribe = engine.subscribe((state: SyncState) => seen.push(state.phase))
    await store.enqueue([draft('v-a')])

    await engine.sync()
    unsubscribe()
    await store.enqueue([draft('v-b')])
    await engine.sync()

    expect(seen).toEqual(['syncing', 'idle'])
  })

  it('parar cancela a espera e desliga os avisos', async () => {
    const { store, engine, clock } = await setup([new SyncFailure('NETWORK', 'x')])
    const listener = vi.fn()
    engine.subscribe(listener)
    await store.enqueue([draft('v-a')])
    await engine.sync()
    listener.mockClear()

    engine.stop()

    expect(clock.waiting()).toHaveLength(0)
    await engine.sync().catch(() => undefined)
    expect(listener).not.toHaveBeenCalled()
  })
})

describe('gatilhos do navegador', () => {
  function environment(visibility: 'visible' | 'hidden' = 'visible') {
    const target = new EventTarget()
    const doc = new EventTarget() as EventTarget & { visibilityState: string }
    doc.visibilityState = visibility
    return {
      target,
      doc,
      env: {
        window: target as unknown as Window,
        document: doc as unknown as Document,
      },
    }
  }

  it('sincroniza quando o sinal volta e quando a pessoa volta para o app', () => {
    const { target, doc, env } = environment()
    const sync = vi.fn(() => Promise.resolve({ phase: 'idle' } as SyncState))
    attachSyncTriggers({ sync }, env)

    target.dispatchEvent(new Event('online'))
    doc.dispatchEvent(new Event('visibilitychange'))

    expect(sync).toHaveBeenCalledTimes(2)
  })

  it('não sincroniza ao esconder o app', () => {
    const { doc, env } = environment('hidden')
    const sync = vi.fn(() => Promise.resolve({ phase: 'idle' } as SyncState))
    attachSyncTriggers({ sync }, env)

    doc.dispatchEvent(new Event('visibilitychange'))

    expect(sync).not.toHaveBeenCalled()
  })

  it('desligar os gatilhos para de sincronizar', () => {
    const { target, env } = environment()
    const sync = vi.fn(() => Promise.resolve({ phase: 'idle' } as SyncState))
    const detach = attachSyncTriggers({ sync }, env)

    detach()
    target.dispatchEvent(new Event('online'))

    expect(sync).not.toHaveBeenCalled()
  })

  it('usa a janela e o documento de verdade quando ninguém informa', () => {
    const sync = vi.fn(() => Promise.resolve({ phase: 'idle' } as SyncState))
    const detach = attachSyncTriggers({ sync })

    window.dispatchEvent(new Event('online'))
    detach()
    window.dispatchEvent(new Event('online'))

    expect(sync).toHaveBeenCalledTimes(1)
  })
})
