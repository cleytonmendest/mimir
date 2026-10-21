import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { openDB } from 'idb'
import { beforeEach, describe, expect, it } from 'vitest'
import { checkInEvents, type EventDraft } from '@/domain/execution'
import { ana as repositor, makeVisit } from '@/domain/testing'
import type { Market } from '@/lib/supabase/mappers'
import {
  deleteUserStore,
  openDeviceStore,
  openUserStore,
  openVersioned,
  toStoreError,
  OfflineStoreError,
  type Migration,
  type Snapshot,
} from './store'

const ANA = '00000000-0000-0000-0000-0000000000a1'
const BRUNO = '00000000-0000-0000-0000-0000000000b1'

const NOW = '2026-10-21T15:00:00.000Z'
const market: Market = { id: 'm-a', name: 'Mercado A', address: null, archived: false }

function snapshot(visits = [makeVisit({ id: 'v-a', date: '2026-10-21' })]): Snapshot {
  return { visits, markets: [market], route: [], fetchedAt: NOW }
}

function sequentialIds(prefix = 'e') {
  let counter = 0
  return () => `${prefix}-${++counter}`
}

const checkIn: EventDraft = {
  type: 'checkIn',
  visitId: 'v-a',
  occurredAt: '2026-10-21T12:00:00.000Z',
}
const checkOut: EventDraft = {
  type: 'checkOut',
  visitId: 'v-a',
  occurredAt: '2026-10-21T12:40:00.000Z',
  note: 'Tudo certo',
}

/** Cada teste começa com um aparelho novo, sem nada guardado. */
beforeEach(() => {
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
})

async function userStore(userId = ANA, newId = sequentialIds()) {
  return openUserStore(userId, { now: () => NOW, newId })
}

describe('o aparelho', () => {
  it('o deviceId nasce uma vez e é o mesmo nas próximas aberturas', async () => {
    const first = await openDeviceStore({ newId: () => 'device-1' })
    expect(await first.deviceId()).toBe('device-1')
    first.close()

    const second = await openDeviceStore({ newId: () => 'device-2' })
    expect(await second.deviceId()).toBe('device-1')
  })

  it('guarda e apaga a última identidade', async () => {
    const device = await openDeviceStore()
    expect(await device.identity()).toBeNull()

    const identity = {
      profile: { id: ANA, role: 'repositor' as const, fullName: 'Ana' },
      savedAt: NOW,
    }
    await device.saveIdentity(identity)
    expect(await device.identity()).toEqual(identity)

    await device.clearIdentity()
    expect(await device.identity()).toBeNull()
  })
})

describe('um banco por usuário', () => {
  it('dois repositores no mesmo celular não misturam fila nem cópia', async () => {
    const ana = await userStore(ANA)
    const bruno = await userStore(BRUNO)

    await ana.saveSnapshot(snapshot())
    await ana.enqueue([checkIn])

    expect((await ana.read()).pending).toHaveLength(1)
    expect(await bruno.read()).toMatchObject({ snapshot: null, pending: [], rejected: [] })
  })

  it('o que foi gravado sobrevive a fechar e abrir de novo', async () => {
    const first = await userStore()
    await first.saveSnapshot(snapshot())
    await first.enqueue([checkIn])
    first.close()

    const view = await (await userStore()).read()
    expect(view.snapshot?.visits).toHaveLength(1)
    expect(view.pending).toHaveLength(1)
  })

  it('apagar o banco de um usuário não toca no de outro', async () => {
    const ana = await userStore(ANA)
    const bruno = await userStore(BRUNO)
    await ana.enqueue([checkIn])
    await bruno.enqueue([checkIn])
    ana.close()

    await deleteUserStore(ANA)

    expect((await (await userStore(ANA)).read()).pending).toEqual([])
    expect((await bruno.read()).pending).toHaveLength(1)
  })
})

describe('a cópia do servidor', () => {
  it('começa vazia e guarda o que foi lido', async () => {
    const store = await userStore()
    expect(await store.read()).toEqual({
      snapshot: null,
      pending: [],
      rejected: [],
      lastSyncAt: null,
      clockOffsetMs: null,
    })

    await store.saveSnapshot(snapshot())
    expect((await store.read()).snapshot).toEqual(snapshot())
  })

  it('trocar a cópia não mexe na fila', async () => {
    const store = await userStore()
    await store.enqueue([checkIn])

    await store.saveSnapshot(snapshot())

    expect((await store.read()).pending).toHaveLength(1)
  })
})

describe('a fila', () => {
  it('numera na ordem em que foi gravada e dá um id a cada evento', async () => {
    const store = await userStore()

    const first = await store.enqueue([checkIn])
    const second = await store.enqueue([checkOut])

    expect(first).toEqual([{ ...checkIn, clientEventId: 'e-1', seq: 1 }])
    expect(second).toEqual([{ ...checkOut, clientEventId: 'e-2', seq: 2 }])
    expect(await store.pending()).toEqual([...first, ...second])
  })

  it('a ação e o que ela provoca entram juntos, os derivados apontando para a causa', async () => {
    const store = await userStore()
    const visits = [
      makeVisit({
        id: 'old',
        marketId: 'm1',
        date: '2026-10-21',
        status: 'in_progress',
        checkInAt: '2026-10-21T09:00:00.000Z',
      }),
      makeVisit({ id: 'new', marketId: 'm2', date: '2026-10-21' }),
    ]
    const { event, derived } = checkInEvents(visits, 'new', {
      actor: repositor,
      now: '2026-10-21T12:00:00.000Z',
      today: '2026-10-21',
    })

    const saved = await store.enqueue([event, ...derived])

    expect(saved.map((item) => [item.seq, item.visitId, item.type])).toEqual([
      [1, 'new', 'checkIn'],
      [2, 'old', 'checkOut'],
    ])
    expect(saved[0]).not.toHaveProperty('causedBy')
    expect(saved[1]).toMatchObject({ causedBy: saved[0]?.clientEventId })
    expect(await store.pending()).toEqual(saved)
  })

  it('lista vazia não grava nada', async () => {
    const store = await userStore()
    expect(await store.enqueue([])).toEqual([])
    expect((await store.read()).pending).toEqual([])
  })

  it('ou entra tudo, ou nada: um id repetido no meio desfaz a gravação inteira', async () => {
    const store = await userStore(ANA, () => 'sempre-o-mesmo')

    const failure: unknown = await store
      .enqueue([checkIn, checkOut])
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(OfflineStoreError)
    expect(failure).toMatchObject({ code: 'CONSTRAINT' })
    expect((await store.read()).pending).toEqual([])
  })

  it('o número de ordem nunca é reaproveitado, nem depois de apagar a fila', async () => {
    const store = await userStore()
    const [first] = await store.enqueue([checkIn])
    await store.ack({
      applied: [first?.clientEventId ?? ''],
      rejected: [],
      visits: [],
      serverNow: NOW,
      deviceNow: NOW,
    })

    const [second] = await store.enqueue([checkOut])

    expect(second?.seq).toBe(2)
  })

  it('pending respeita o limite do lote e a ordem', async () => {
    const store = await userStore()
    await store.enqueue([checkIn])
    await store.enqueue([checkOut])
    await store.enqueue([{ ...checkIn, visitId: 'v-b' }])

    expect((await store.pending(2)).map((event) => event.seq)).toEqual([1, 2])
    expect((await store.pending()).map((event) => event.seq)).toEqual([1, 2, 3])
  })
})

describe('o resultado de um envio (ack)', () => {
  const received = { serverNow: '2026-10-21T15:00:05.000Z', deviceNow: '2026-10-21T15:00:00.000Z' }

  it('o que o servidor aplicou sai da fila', async () => {
    const store = await userStore()
    const [first, second] = await store.enqueue([checkIn, { ...checkOut, visitId: 'v-b' }])

    await store.ack({
      applied: [first?.clientEventId ?? ''],
      rejected: [],
      visits: [],
      ...received,
    })

    expect((await store.pending()).map((event) => event.clientEventId)).toEqual([
      second?.clientEventId,
    ])
  })

  it('o recusado sai da fila de envio mas fica guardado, com o motivo', async () => {
    const store = await userStore()
    const [event] = await store.enqueue([checkIn])

    await store.ack({
      applied: [],
      rejected: [
        {
          clientEventId: event?.clientEventId ?? '',
          code: 'INVALID_TRANSITION',
          visitStatus: 'cancelled',
        },
      ],
      visits: [],
      ...received,
    })

    const view = await store.read()
    expect(view.pending).toEqual([])
    expect(view.rejected).toEqual([
      {
        event,
        rejection: {
          code: 'INVALID_TRANSITION',
          visitStatus: 'cancelled',
          rejectedAt: received.deviceNow,
        },
      },
    ])
  })

  it('a pessoa dispensa a explicação e o recusado some', async () => {
    const store = await userStore()
    const [event] = await store.enqueue([checkIn])
    const id = event?.clientEventId ?? ''
    await store.ack({
      applied: [],
      rejected: [{ clientEventId: id, code: 'FORBIDDEN', visitStatus: null }],
      visits: [],
      ...received,
    })

    await store.dismissRejected(id)

    expect((await store.read()).rejected).toEqual([])
  })

  it('dispensar não apaga um evento que ainda está na fila', async () => {
    const store = await userStore()
    const [event] = await store.enqueue([checkIn])

    await store.dismissRejected(event?.clientEventId ?? '')

    expect(await store.pending()).toHaveLength(1)
  })

  it('as visitas devolvidas pelo servidor atualizam a cópia, na ordem da agenda', async () => {
    const store = await userStore()
    const a = makeVisit({ id: 'v-a', date: '2026-10-21', order: 1 })
    const b = makeVisit({ id: 'v-b', marketId: 'm-b', date: '2026-10-21', order: 0 })
    await store.saveSnapshot(snapshot([a]))
    const done = { ...a, status: 'done' as const, checkInAt: NOW, checkOutAt: NOW }

    await store.ack({ applied: [], rejected: [], visits: [done, b], ...received })

    expect((await store.read()).snapshot?.visits).toEqual([b, done])
  })

  it('guarda quando foi e quanto o relógio do aparelho está errado', async () => {
    const store = await userStore()

    await store.ack({ applied: [], rejected: [], visits: [], ...received })

    expect(await store.read()).toMatchObject({
      lastSyncAt: received.deviceNow,
      clockOffsetMs: 5_000,
    })
  })

  it('sem cópia ainda, as visitas não têm onde entrar mas a fila se acerta', async () => {
    const store = await userStore()
    const [event] = await store.enqueue([checkIn])

    await store.ack({
      applied: [event?.clientEventId ?? ''],
      rejected: [],
      visits: [makeVisit()],
      ...received,
    })

    const view = await store.read()
    expect(view.snapshot).toBeNull()
    expect(view.pending).toEqual([])
  })

  it('repetir o mesmo ack não muda nada e ids desconhecidos são ignorados', async () => {
    const store = await userStore()
    const [event] = await store.enqueue([checkIn])
    const input = {
      applied: [event?.clientEventId ?? '', 'nunca-existiu'],
      rejected: [{ clientEventId: 'tambem-nao', code: 'FORBIDDEN' as const, visitStatus: null }],
      visits: [],
      ...received,
    }

    await store.ack(input)
    const once = await store.read()
    await store.ack(input)

    expect(await store.read()).toEqual(once)
  })

  it('ou tudo ou nada: se a cópia não puder ser gravada, a fila continua como estava', async () => {
    const store = await userStore()
    await store.saveSnapshot(snapshot())
    const [event] = await store.enqueue([checkIn])
    // Uma função não cabe no banco: a gravação da cópia falha no fim da transação.
    const poisoned = { ...makeVisit({ id: 'v-a' }), note: (() => 'x') as unknown as string }

    const failure: unknown = await store
      .ack({ applied: [event?.clientEventId ?? ''], rejected: [], visits: [poisoned], ...received })
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(OfflineStoreError)
    const view = await store.read()
    expect(view.pending).toEqual([event])
    expect(view.lastSyncAt).toBeNull()
  })
})

describe('versões do banco', () => {
  const v1: Migration = (db) => {
    db.createObjectStore('items', { keyPath: 'id' })
  }
  const v2: Migration = (db, transaction) => {
    transaction.objectStore('items').createIndex('byName', 'name')
    db.createObjectStore('extras')
  }

  it('roda só os passos que faltam e preserva o que já estava gravado', async () => {
    const first = await openVersioned<never>('migra', [v1])
    await first.put('items' as never, { id: 1, name: 'um' } as never)
    first.close()

    const second = await openVersioned<never>('migra', [v1, v2])

    expect(second.version).toBe(2)
    expect(Array.from(second.objectStoreNames)).toEqual(['extras', 'items'])
    expect(await second.get('items' as never, 1 as never)).toEqual({ id: 1, name: 'um' })
    expect(second.transaction('items' as never).store.indexNames.contains('byName' as never)).toBe(
      true,
    )
  })

  it('um app antigo ainda aberto lê o banco que um app novo já migrou', async () => {
    const newer = await openVersioned<never>('migra-volta', [v1, v2])
    await newer.put('items' as never, { id: 7, name: 'novo' } as never)
    newer.close()

    const older = await openVersioned<never>('migra-volta', [v1])

    expect(older.version).toBe(2)
    expect(await older.get('items' as never, 7 as never)).toEqual({ id: 7, name: 'novo' })
  })

  it('um app novo aberto numa outra aba não fica preso esperando o antigo', async () => {
    const old = await openVersioned<never>('migra-aba', [v1])

    const upgraded = await openVersioned<never>('migra-aba', [v1, v2])

    expect(upgraded.version).toBe(2)
    // O antigo se fechou sozinho para liberar a migration.
    await expect(old.get('items' as never, 1 as never)).rejects.toMatchObject({
      name: 'InvalidStateError',
    })
  })

  it('o banco do usuário abre na versão atual', async () => {
    await (await userStore()).saveSnapshot(snapshot())
    const raw = await openDB(`rota-${ANA}`)
    expect(raw.version).toBe(1)
    expect(Array.from(raw.objectStoreNames).sort()).toEqual(['meta', 'outbox', 'snapshot'])
  })
})

describe('quando o aparelho não consegue guardar', () => {
  it.each([
    ['QuotaExceededError', 'QUOTA'],
    ['ConstraintError', 'CONSTRAINT'],
    ['InvalidStateError', 'UNAVAILABLE'],
    ['SecurityError', 'UNAVAILABLE'],
    ['AbortError', 'UNAVAILABLE'],
    ['OutroErro', 'UNKNOWN'],
  ])('%s vira %s', (name, code) => {
    const error = Object.assign(new Error('boom'), { name })
    expect(toStoreError(error)).toMatchObject({ code })
  })

  it('o que não é erro de verdade também vira erro do armazenamento', () => {
    expect(toStoreError('texto solto')).toMatchObject({ code: 'UNKNOWN' })
    expect(toStoreError(null)).toMatchObject({ code: 'UNKNOWN' })
  })

  it('um erro do armazenamento passa como está', () => {
    const original = new OfflineStoreError('QUOTA', 'cheio')
    expect(toStoreError(original)).toBe(original)
  })

  it('o navegador recusa abrir o banco (modo privado, bloqueio): erro explicável', async () => {
    const refuses = () => {
      throw Object.assign(new Error('bloqueado'), { name: 'SecurityError' })
    }
    ;(globalThis as { indexedDB: unknown }).indexedDB = { open: refuses, deleteDatabase: refuses }

    await expect(openUserStore(ANA)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    await expect(deleteUserStore(ANA)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  })

  it('navegador sem IndexedDB: erro explicável, não ReferenceError', async () => {
    const original = (globalThis as { indexedDB?: IDBFactory }).indexedDB
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB
    try {
      await expect(openUserStore(ANA)).rejects.toMatchObject({ code: 'UNAVAILABLE' })
    } finally {
      ;(globalThis as { indexedDB?: IDBFactory }).indexedDB = original
    }
  })
})
