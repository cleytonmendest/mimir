import { afterEach, describe, expect, it, vi } from 'vitest'
import { NO_CHECKOUT_REASON } from '@/domain/carryover'
import { AUTO_CHECKOUT_NOTE } from '@/domain/execution'
import { ana, idGenerator, makeVisit } from '@/domain/testing'
import type { StandardRouteEntry, Visit } from '@/domain/types'
import { OfflineStoreError } from '@/lib/offline/store'
import { ConfigError } from '@/lib/supabase/errors'
import { market, createDevice, NOW, TODAY, type FakeServer } from './testing'
import { createTodayController, todaysVisits, type TodayState } from './today-controller'

const MARKETS = [
  market('market-a', 'Mercado A'),
  market('market-b', 'Mercado B'),
  market('market-c', 'Mercado C'),
]

const route = (weekday: StandardRouteEntry['weekday'], marketId: string, order: number) => ({
  repositorId: ana.id,
  weekday,
  marketId,
  order,
})

let device: Awaited<ReturnType<typeof createDevice>> | undefined

afterEach(() => {
  device?.close()
  device = undefined
})

async function setup(seed: Partial<FakeServer> = {}) {
  device = await createDevice({ markets: MARKETS, ...seed })
  const controller = createTodayController({
    actor: ana,
    gateway: device.fake.gateway,
    session: device.session,
    clock: device.clock,
    newId: idGenerator('new'),
  })
  return { ...device, controller }
}

function ready(state: TodayState) {
  if (state.status !== 'ready') throw new Error(`esperava "ready" e veio "${state.status}"`)
  return state
}

const today = (overrides: Partial<Visit> = {}) => makeVisit({ date: TODAY, ...overrides })

describe('carregar o dia', () => {
  it('abre a semana pela rota padrão: cria do dia de hoje em diante, na ordem da rota', async () => {
    const { controller, fake } = await setup({
      route: [
        route(1, 'market-c', 0), // segunda: já passou, não se cria
        route(3, 'market-b', 1),
        route(3, 'market-a', 0),
        route(4, 'market-c', 0), // quinta: cria, mas não aparece hoje
      ],
    })

    await controller.load()

    const state = ready(controller.getState())
    expect(
      todaysVisits(state).map((visit) => [visit.marketId, visit.order, visit.status, visit.origin]),
    ).toEqual([
      ['market-a', 0, 'planned', 'standard'],
      ['market-b', 1, 'planned', 'standard'],
    ])
    expect(fake.server.visits.map((visit) => [visit.date, visit.marketId])).toEqual([
      [TODAY, 'market-a'],
      [TODAY, 'market-b'],
      ['2026-10-22', 'market-c'],
    ])
    expect(state.day).toBe(TODAY)
    expect(state.markets.get('market-a')?.name).toBe('Mercado A')
    expect(state.stale).toBe(false)
  })

  it('guarda a cópia no aparelho, com a hora em que foi lida', async () => {
    const { controller, session } = await setup({ visits: [today({ id: 'v-a' })] })

    await controller.load()

    const view = await session.store.read()
    expect(view.snapshot?.visits.map((visit) => visit.id)).toEqual(['v-a'])
    expect(view.snapshot?.fetchedAt).toBe(NOW)
    expect(ready(controller.getState()).fetchedAt).toBe(NOW)
  })

  it('não duplica o que já existe, não ressuscita a cancelada e não mostra a de outro dia', async () => {
    const { controller, fake } = await setup({
      route: [route(3, 'market-a', 0), route(3, 'market-b', 1)],
      visits: [
        today({ id: 'v-a', marketId: 'market-a', status: 'cancelled' }),
        makeVisit({ id: 'v-ontem', marketId: 'market-c', date: '2026-10-20', status: 'done' }),
      ],
    })

    await controller.load()

    expect(todaysVisits(ready(controller.getState())).map((visit) => visit.marketId)).toEqual([
      'market-b',
    ])
    expect(fake.server.visits.filter((visit) => visit.marketId === 'market-a')).toHaveLength(1)
  })

  it('carregar duas vezes ao mesmo tempo (React em modo estrito) termina uma vez e sem duplicar', async () => {
    const { controller, fake } = await setup({ route: [route(3, 'market-a', 0)] })

    await Promise.all([controller.load(), controller.load()])

    expect(ready(controller.getState()).visits).toHaveLength(1)
    expect(fake.server.visits).toHaveLength(1)
  })

  it('primeira vez sem rede e nada guardado: avisa, e carregar de novo com rede recupera', async () => {
    const { controller, net } = await setup({ route: [route(3, 'market-a', 0)] })
    net.online = false

    await controller.load()
    expect(controller.getState()).toEqual({
      status: 'failed',
      message: 'Não foi possível conectar ao servidor. Verifique a internet e tente de novo.',
    })

    net.online = true
    await controller.load()
    expect(controller.getState().status).toBe('ready')
  })

  it('sem configuração do Supabase mostra o texto real, que é de quem implantou o app', async () => {
    const { controller, fake } = await setup()
    fake.failNext('listMarkets', new ConfigError('Defina VITE_SUPABASE_URL'))

    await controller.load()

    expect(controller.getState()).toEqual({ status: 'failed', message: 'Defina VITE_SUPABASE_URL' })
  })

  it('o aparelho não consegue ler o que guardou: avisa do armazenamento', async () => {
    const { controller, session } = await setup()
    vi.spyOn(session.store, 'read').mockRejectedValueOnce(new OfflineStoreError('UNAVAILABLE', 'x'))

    await controller.load()

    expect(controller.getState()).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('guardar neste aparelho'),
    })
  })

  it('recarregar com a lista na tela não a esconde; sem rede ela fica, marcada como guardada', async () => {
    const { controller, net } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    const seen: string[] = []
    controller.subscribe(() => seen.push(controller.getState().status))
    net.online = false

    await controller.load()

    expect(seen).not.toContain('loading')
    const state = ready(controller.getState())
    expect(state.visits).toHaveLength(1)
    expect(state.stale).toBe(true)
  })
})

describe('abrir o app sem sinal', () => {
  it('mostra na hora a lista que ficou guardada, sem tela de erro', async () => {
    const { controller, net, open, fake, clock } = await setup({
      visits: [today({ id: 'v-a' }), today({ id: 'v-b', marketId: 'market-b', order: 1 })],
    })
    await controller.load()
    // O app é fechado, o celular perde o sinal e o app é aberto de novo.
    net.online = false
    const reopened = await open()
    const again = createTodayController({
      actor: ana,
      gateway: fake.gateway,
      session: reopened,
      clock,
      newId: idGenerator('new'),
    })

    await again.load()

    const state = ready(again.getState())
    expect(todaysVisits(state).map((visit) => visit.id)).toEqual(['v-a', 'v-b'])
    expect(state.stale).toBe(true)
  })

  it('o que a pessoa fez sem sinal continua na tela depois de fechar e abrir o app', async () => {
    const { controller, net, open, fake, clock } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    net.online = false
    await controller.checkIn('v-a')
    const reopened = await open()
    const again = createTodayController({
      actor: ana,
      gateway: fake.gateway,
      session: reopened,
      clock,
    })

    await again.load()

    const state = ready(again.getState())
    expect(state.visits[0]).toMatchObject({ status: 'in_progress', checkInAt: NOW })
    expect(state.unsent).toBe(1)
    expect(state.unsentVisitIds.has('v-a')).toBe(true)
  })
})

describe('check-in', () => {
  it('com sinal: a tela muda na hora e o servidor recebe o evento', async () => {
    const { controller, fake } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()

    await controller.checkIn('v-a')
    expect(ready(controller.getState()).visits[0]).toMatchObject({ status: 'in_progress' })
    await controller.syncNow()

    expect(fake.visit('v-a')).toMatchObject({ status: 'in_progress', checkInAt: NOW })
    const state = ready(controller.getState())
    expect(state.unsent).toBe(0)
    expect(state.unsentVisitIds.size).toBe(0)
    expect(state.sync).toEqual({ phase: 'idle' })
    expect(state.notice).toBeNull()
  })

  it('sem sinal: a tela muda na hora, o servidor não sabe de nada e a fila guarda o evento', async () => {
    const { controller, fake, net } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    net.online = false

    await controller.checkIn('v-a')
    await controller.syncNow()

    const state = ready(controller.getState())
    expect(state.visits[0]).toMatchObject({ status: 'in_progress', checkInAt: NOW })
    expect(state.unsent).toBe(1)
    expect(state.unsentVisitIds.has('v-a')).toBe(true)
    expect(state.sync).toMatchObject({ phase: 'waiting', reason: 'NETWORK' })
    expect(fake.visit('v-a').status).toBe('planned')
  })

  it('quando o sinal volta, "enviar agora" leva tudo e a fila esvazia', async () => {
    const { controller, fake, net } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    net.online = false
    await controller.checkIn('v-a')
    await controller.syncNow()
    net.online = true

    await controller.syncNow()

    expect(fake.visit('v-a')).toMatchObject({ status: 'in_progress', checkInAt: NOW })
    const state = ready(controller.getState())
    expect(state.unsent).toBe(0)
    expect(state.lastSyncAt).toBe(NOW)
    expect(state.sync).toEqual({ phase: 'idle' })
  })

  it('encerra a visita que ficou aberta (hoje: feita; dia que passou: "não foi"), tudo junto na fila', async () => {
    const { controller, fake, session } = await setup({
      visits: [
        makeVisit({
          id: 'v-ontem',
          marketId: 'market-c',
          date: '2026-10-20',
          status: 'in_progress',
          checkInAt: '2026-10-20T13:00:00.000Z',
        }),
        today({
          id: 'v-a',
          marketId: 'market-a',
          status: 'in_progress',
          checkInAt: '2026-10-21T10:00:00.000Z',
        }),
        today({ id: 'v-b', marketId: 'market-b', order: 1 }),
      ],
    })
    await controller.load()

    await controller.checkIn('v-b')

    // Na tela, e na fila do aparelho, já está tudo.
    const pending = await session.store.pending()
    expect(pending.map((event) => [event.visitId, event.type])).toEqual([
      ['v-b', 'checkIn'],
      ['v-ontem', 'markNotDone'],
      ['v-a', 'checkOut'],
    ])
    expect(pending.slice(1).every((event) => event.causedBy === pending[0]?.clientEventId)).toBe(
      true,
    )
    await controller.syncNow()

    expect(fake.visit('v-a')).toMatchObject({
      status: 'done',
      checkOutAt: NOW,
      note: AUTO_CHECKOUT_NOTE,
    })
    expect(fake.visit('v-ontem')).toMatchObject({
      status: 'not_done',
      skipReason: NO_CHECKOUT_REASON,
    })
    expect(fake.visit('v-b')).toMatchObject({ status: 'in_progress', checkInAt: NOW })
  })

  it('visita de dia que já passou não se inicia: avisa e nada entra na fila', async () => {
    const { controller, session } = await setup({
      visits: [
        today({ id: 'v-a' }),
        makeVisit({ id: 'v-old', marketId: 'market-c', date: '2026-10-20' }),
      ],
    })
    await controller.load()

    await controller.checkIn('v-old')

    expect(ready(controller.getState()).notice).toContain('dia que já passou')
    expect(await session.store.pending()).toEqual([])
  })
})

describe('check-out', () => {
  const inProgress = () =>
    today({ id: 'v-a', status: 'in_progress', checkInAt: '2026-10-21T10:00:00.000Z' })

  it('conclui a visita com horário e observação', async () => {
    const { controller, fake } = await setup({ visits: [inProgress()] })
    await controller.load()

    await controller.checkOut('v-a', '  Gôndola reposta  ')
    await controller.syncNow()

    expect(fake.visit('v-a')).toMatchObject({
      status: 'done',
      checkInAt: '2026-10-21T10:00:00.000Z',
      checkOutAt: NOW,
      note: 'Gôndola reposta',
    })
  })

  it('observação em branco conclui sem inventar texto', async () => {
    const { controller, fake } = await setup({ visits: [inProgress()] })
    await controller.load()

    await controller.checkOut('v-a', '   ')
    await controller.syncNow()

    expect(fake.visit('v-a')).toMatchObject({ status: 'done', note: null })
  })

  it('check-out sem check-in é recusado antes de entrar na fila', async () => {
    const { controller, session } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()

    await controller.checkOut('v-a', '')

    expect(ready(controller.getState()).notice).toContain('não é possível')
    expect(await session.store.pending()).toEqual([])
  })
})

describe('"não fui"', () => {
  it('exige motivo: sem ele avisa e não guarda nada', async () => {
    const { controller, fake, session } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()

    await controller.markNotDone('v-a', '   ')

    expect(ready(controller.getState()).notice).toBe('Informe o motivo de não ter ido')
    expect(await session.store.pending()).toEqual([])
    expect(fake.visit('v-a').status).toBe('planned')
  })

  it('com motivo, marca como "não foi"', async () => {
    const { controller, fake } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()

    await controller.markNotDone('v-a', ' Loja fechada ')
    await controller.syncNow()

    expect(fake.visit('v-a')).toMatchObject({ status: 'not_done', skipReason: 'Loja fechada' })
  })
})

describe('quando o servidor discorda', () => {
  it('o líder cancelou a visita enquanto o aparelho estava sem sinal: a recusa é explicada e a visita sai da lista', async () => {
    const { controller, fake, net } = await setup({
      visits: [today({ id: 'v-a' }), today({ id: 'v-b', marketId: 'market-b', order: 1 })],
    })
    await controller.load()
    net.online = false
    await controller.checkIn('v-a')
    fake.visit('v-a').status = 'cancelled' // o líder cancela no servidor
    net.online = true

    await controller.syncNow()

    const state = ready(controller.getState())
    expect(state.rejections).toEqual([
      {
        id: expect.any(String),
        text: 'Check-in no Mercado A: a visita foi cancelada pelo líder.',
      },
    ])
    expect(state.unsent).toBe(0)
    expect(todaysVisits(state).map((visit) => visit.id)).toEqual(['v-b'])
    expect(fake.visit('v-a')).toMatchObject({ status: 'cancelled', checkInAt: null })
  })

  it('a pessoa dispensa a explicação e ela some', async () => {
    const { controller, fake, net } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    net.online = false
    await controller.checkIn('v-a')
    fake.visit('v-a').status = 'done'
    fake.visit('v-a').checkInAt = NOW
    fake.visit('v-a').checkOutAt = NOW
    net.online = true
    await controller.syncNow()
    const [rejection] = ready(controller.getState()).rejections
    expect(rejection?.text).toContain('já estava registrada como feita')

    await controller.dismissRejection(rejection?.id ?? '')

    expect(ready(controller.getState()).rejections).toEqual([])
  })
})

describe('quando guardar falha', () => {
  it('sem espaço no aparelho: avisa, e a tela não finge que registrou', async () => {
    const { controller, session } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    vi.spyOn(session.store, 'enqueue').mockRejectedValueOnce(
      new OfflineStoreError('QUOTA', 'cheio'),
    )

    await controller.checkIn('v-a')

    const state = ready(controller.getState())
    expect(state.notice).toContain('guardar neste aparelho')
    expect(state.visits[0]?.status).toBe('planned')
    expect(state.busyVisitId).toBeNull()
  })

  it('erro inesperado vira aviso genérico, não exceção', async () => {
    const { controller, session } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    vi.spyOn(session.store, 'enqueue').mockRejectedValueOnce(new Error('???'))

    await controller.checkIn('v-a')

    expect(ready(controller.getState()).notice).toBe('Não foi possível registrar. Tente de novo.')
  })

  it('visita que não existe mais na lista vira aviso, não exceção', async () => {
    const { controller } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()

    await controller.checkIn('v-fantasma')

    expect(ready(controller.getState()).notice).toContain('não existe')
  })
})

describe('regras da tela', () => {
  it('a tela ficou aberta de um dia para o outro: não guarda, recarrega no novo dia e avisa', async () => {
    const { controller, moment, session } = await setup({
      visits: [today({ id: 'v-a' })],
      route: [route(4, 'market-b', 0)],
    })
    await controller.load()
    moment.today = '2026-10-22'
    moment.now = '2026-10-22T11:00:00.000Z'

    await controller.checkIn('v-a')

    const state = ready(controller.getState())
    expect(await session.store.pending()).toEqual([])
    expect(state.day).toBe('2026-10-22')
    expect(state.notice).toBe('Um novo dia começou. Atualizamos a lista.')
    expect(todaysVisits(state).map((visit) => visit.marketId)).toEqual(['market-b'])
  })

  it('não aceita duas ações ao mesmo tempo (toque duplo)', async () => {
    const { controller, session } = await setup({
      visits: [today({ id: 'v-a' }), today({ id: 'v-b', marketId: 'market-b', order: 1 })],
    })
    await controller.load()

    const first = controller.checkIn('v-a')
    const second = controller.checkIn('v-b')
    expect(ready(controller.getState()).busyVisitId).toBe('v-a')
    await Promise.all([first, second])

    expect((await session.store.pending()).map((event) => event.visitId)).toEqual(['v-a'])
    expect(ready(controller.getState()).busyVisitId).toBeNull()
  })

  it('só age depois de carregar', async () => {
    const { controller, session } = await setup({ visits: [today({ id: 'v-a' })] })

    await controller.checkIn('v-a')

    expect(await session.store.pending()).toEqual([])
    expect(controller.getState().status).toBe('loading')
  })

  it('avisa quem acompanha a cada mudança, e para de avisar depois de cancelar', async () => {
    const { controller } = await setup({ visits: [today({ id: 'v-a' })] })
    let calls = 0
    const cancel = controller.subscribe(() => calls++)

    await controller.load()
    const afterLoad = calls
    expect(afterLoad).toBeGreaterThan(0)

    cancel()
    await controller.checkIn('v-a')
    expect(calls).toBe(afterLoad)
  })

  it('fechar o aviso o limpa', async () => {
    const { controller } = await setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    await controller.markNotDone('v-a', '')
    expect(ready(controller.getState()).notice).not.toBeNull()

    controller.dismissNotice()

    expect(ready(controller.getState()).notice).toBeNull()
  })

  it('dismissNotice antes de carregar não faz nada', async () => {
    const { controller } = await setup()
    controller.dismissNotice()
    expect(controller.getState().status).toBe('loading')
  })
})

describe('acompanhar o envio', () => {
  it('start() carrega o dia e passa a refletir cada mudança do motor de envio', async () => {
    const { controller, net, fake } = await setup({ visits: [today({ id: 'v-a' })] })
    const stop = controller.start()
    await vi.waitFor(() => expect(controller.getState().status).toBe('ready'))
    net.online = false
    await controller.checkIn('v-a')
    await vi.waitFor(() =>
      expect(ready(controller.getState()).sync).toMatchObject({ phase: 'waiting' }),
    )
    net.online = true

    await controller.syncNow()

    await vi.waitFor(() => expect(ready(controller.getState()).unsent).toBe(0))
    expect(fake.visit('v-a').status).toBe('in_progress')
    stop()
  })

  it('depois de parar, as mudanças do motor não chegam mais à tela', async () => {
    const { controller, net, session } = await setup({ visits: [today({ id: 'v-a' })] })
    const stop = controller.start()
    await vi.waitFor(() => expect(controller.getState().status).toBe('ready'))
    stop()
    net.online = false
    await controller.checkIn('v-a')

    // O motor tenta sozinho (e falha, sem sinal), mas a tela já não o escuta.
    await vi.waitFor(() => expect(session.engine.state().phase).toBe('waiting'))

    expect(ready(controller.getState()).sync).toEqual({ phase: 'idle' })
  })

  it('unsentCount diz quantos registros ainda não foram enviados', async () => {
    const { controller, net } = await setup({
      visits: [today({ id: 'v-a' }), today({ id: 'v-b', marketId: 'market-b', order: 1 })],
    })
    await controller.load()
    net.online = false
    await controller.checkIn('v-a')
    await controller.markNotDone('v-b', 'Fechado')

    expect(await controller.unsentCount()).toBe(2)
  })
})
