import { describe, expect, it } from 'vitest'
import { AUTO_CHECKOUT_NOTE } from '@/domain/execution'
import { NO_CHECKOUT_REASON } from '@/domain/carryover'
import { ana, idGenerator, makeVisit } from '@/domain/testing'
import type { StandardRouteEntry, Visit } from '@/domain/types'
import { ConfigError } from '@/lib/supabase/errors'
import type { Clock, Moment } from './clock'
import { createFakeVisitsGateway, market, type FakeServer } from './testing'
import { createTodayController, todaysVisits, type TodayState } from './today-controller'

// 2026-10-21 é quarta-feira (weekday 3).
const TODAY = '2026-10-21'
const NOW = '2026-10-21T14:00:00.000Z'
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

function setup(seed: Partial<FakeServer> = {}, clock?: Clock) {
  const fake = createFakeVisitsGateway({ markets: MARKETS, ...seed })
  const moment: Moment = { now: NOW, today: TODAY }
  const controller = createTodayController({
    actor: ana,
    gateway: fake.gateway,
    clock: clock ?? (() => ({ ...moment })),
    newId: idGenerator('new'),
  })
  return { ...fake, controller, moment }
}

function ready(state: TodayState) {
  if (state.status !== 'ready') throw new Error(`esperava "ready" e veio "${state.status}"`)
  return state
}

const today = (overrides: Partial<Visit> = {}) => makeVisit({ date: TODAY, ...overrides })

describe('carregar o dia', () => {
  it('abre a semana pela rota padrão: cria do dia de hoje em diante, na ordem da rota', async () => {
    const { controller, server } = setup({
      route: [
        route(1, 'market-c', 0), // segunda: já passou, não se cria
        route(3, 'market-b', 1),
        route(3, 'market-a', 0),
        route(4, 'market-c', 0), // quinta: cria, mas não aparece hoje
      ],
    })

    await controller.load()

    const state = ready(controller.getState())
    const visits = todaysVisits(state)
    expect(
      visits.map((visit) => [visit.marketId, visit.order, visit.status, visit.origin]),
    ).toEqual([
      ['market-a', 0, 'planned', 'standard'],
      ['market-b', 1, 'planned', 'standard'],
    ])
    expect(server.visits.map((visit) => [visit.date, visit.marketId])).toEqual([
      [TODAY, 'market-a'],
      [TODAY, 'market-b'],
      ['2026-10-22', 'market-c'],
    ])
    expect(state.day).toBe(TODAY)
    expect(state.markets.get('market-a')?.name).toBe('Mercado A')
  })

  it('não duplica o que já existe, não ressuscita a cancelada e não mostra a de outro dia', async () => {
    const { controller, server } = setup({
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
    expect(server.visits.filter((visit) => visit.marketId === 'market-a')).toHaveLength(1)
  })

  it('carregar duas vezes ao mesmo tempo (React em modo estrito) termina uma vez e sem duplicar', async () => {
    const { controller, server } = setup({ route: [route(3, 'market-a', 0)] })

    await Promise.all([controller.load(), controller.load()])

    expect(ready(controller.getState()).visits).toHaveLength(1)
    expect(server.visits).toHaveLength(1)
  })

  it('falha ao carregar: mostra o aviso, e carregar de novo recupera', async () => {
    const { controller, failNext } = setup({ route: [route(3, 'market-a', 0)] })
    failNext('listVisits', new Error('sem rede'))

    await controller.load()
    expect(controller.getState()).toEqual({
      status: 'failed',
      message: 'Não foi possível conectar ao servidor. Verifique a internet e tente de novo.',
    })

    await controller.load()
    expect(controller.getState().status).toBe('ready')
  })

  it('sem configuração do Supabase mostra o texto real, que é de quem implantou o app', async () => {
    const { controller, failNext } = setup()
    failNext('listMarkets', new ConfigError('Defina VITE_SUPABASE_URL'))

    await controller.load()

    expect(controller.getState()).toEqual({ status: 'failed', message: 'Defina VITE_SUPABASE_URL' })
  })

  it('recarregar com a lista na tela não a esconde, e uma falha vira aviso sem perder a lista', async () => {
    const { controller, failNext } = setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    const seen: string[] = []
    controller.subscribe(() => seen.push(controller.getState().status))
    failNext('listVisits', new Error('sem rede'))

    await controller.load()

    expect(seen).not.toContain('loading')
    const state = ready(controller.getState())
    expect(state.visits).toHaveLength(1)
    expect(state.notice).toContain('Verifique a internet')
  })
})

describe('check-in', () => {
  it('inicia a visita com o horário do aparelho e grava no servidor', async () => {
    const { controller, visit } = setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()

    await controller.checkIn('v-a')

    expect(visit('v-a')).toMatchObject({ status: 'in_progress', checkInAt: NOW })
    expect(ready(controller.getState()).visits[0]).toMatchObject({ status: 'in_progress' })
    expect(ready(controller.getState()).notice).toBeNull()
  })

  it('encerra a visita que ficou aberta (hoje: feita; dia que passou: "não foi") e grava as encerradas antes da nova', async () => {
    const { controller, visit, saved } = setup({
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

    expect(visit('v-a')).toMatchObject({
      status: 'done',
      checkOutAt: NOW,
      note: AUTO_CHECKOUT_NOTE,
    })
    expect(visit('v-ontem')).toMatchObject({ status: 'not_done', skipReason: NO_CHECKOUT_REASON })
    expect(visit('v-b')).toMatchObject({ status: 'in_progress', checkInAt: NOW })
    expect(saved).toHaveLength(1)
    expect(saved[0]?.at(-1)).toBe('v-b')
    expect(new Set(saved[0])).toEqual(new Set(['v-ontem', 'v-a', 'v-b']))
  })
})

describe('check-out', () => {
  const inProgress = () =>
    today({ id: 'v-a', status: 'in_progress', checkInAt: '2026-10-21T10:00:00.000Z' })

  it('conclui a visita com horário e observação', async () => {
    const { controller, visit } = setup({ visits: [inProgress()] })
    await controller.load()

    await controller.checkOut('v-a', '  Gôndola reposta  ')

    expect(visit('v-a')).toMatchObject({
      status: 'done',
      checkInAt: '2026-10-21T10:00:00.000Z',
      checkOutAt: NOW,
      note: 'Gôndola reposta',
    })
  })

  it('observação em branco conclui sem inventar texto', async () => {
    const { controller, visit } = setup({ visits: [inProgress()] })
    await controller.load()

    await controller.checkOut('v-a', '   ')

    expect(visit('v-a')).toMatchObject({ status: 'done', note: null })
  })
})

describe('"não fui"', () => {
  it('exige motivo: sem ele avisa e não grava nada', async () => {
    const { controller, visit, saved } = setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()

    await controller.markNotDone('v-a', '   ')

    expect(ready(controller.getState()).notice).toBe('Informe o motivo de não ter ido')
    expect(saved).toEqual([])
    expect(visit('v-a').status).toBe('planned')
  })

  it('com motivo, marca como "não foi"', async () => {
    const { controller, visit } = setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()

    await controller.markNotDone('v-a', ' Loja fechada ')

    expect(visit('v-a')).toMatchObject({ status: 'not_done', skipReason: 'Loja fechada' })
  })
})

describe('quando algo dá errado ao gravar', () => {
  it('se o líder cancelou a visita enquanto ela estava aberta: avisa, recarrega e a visita some da lista', async () => {
    const { controller, server, visit } = setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    visit('v-a').status = 'cancelled' // o líder cancela no servidor

    await controller.checkIn('v-a')

    const state = ready(controller.getState())
    expect(state.notice).toBe('Esta visita mudou enquanto você a abria. Atualizamos a lista.')
    expect(todaysVisits(state)).toEqual([])
    expect(server.visits[0]).toMatchObject({ status: 'cancelled', checkInAt: null })
    expect(state.busyVisitId).toBeNull()
  })

  it('falha de rede ao gravar: avisa e a visita continua como estava', async () => {
    const { controller, visit, failNext } = setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    failNext('saveChanges', new Error('sem rede'))

    await controller.checkIn('v-a')

    const state = ready(controller.getState())
    expect(state.notice).toBe('Não foi possível salvar. Verifique a internet e tente de novo.')
    expect(state.visits[0]?.status).toBe('planned')
    expect(visit('v-a').status).toBe('planned')
    expect(state.busyVisitId).toBeNull()
  })

  it('visita que não existe mais na lista vira aviso, não exceção', async () => {
    const { controller } = setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()

    await controller.checkIn('v-fantasma')

    expect(ready(controller.getState()).notice).toContain('não existe')
  })
})

describe('regras da tela', () => {
  it('a tela ficou aberta de um dia para o outro: não grava, recarrega no novo dia e avisa', async () => {
    const { controller, moment, saved } = setup({
      visits: [today({ id: 'v-a' })],
      route: [route(4, 'market-b', 0)],
    })
    await controller.load()
    moment.today = '2026-10-22'
    moment.now = '2026-10-22T11:00:00.000Z'

    await controller.checkIn('v-a')

    const state = ready(controller.getState())
    expect(saved).toEqual([])
    expect(state.day).toBe('2026-10-22')
    expect(state.notice).toBe('Um novo dia começou. Atualizamos a lista.')
    expect(todaysVisits(state).map((visit) => visit.marketId)).toEqual(['market-b'])
  })

  it('não aceita duas ações ao mesmo tempo (toque duplo)', async () => {
    const { controller, saved, visit } = setup({
      visits: [today({ id: 'v-a' }), today({ id: 'v-b', marketId: 'market-b', order: 1 })],
    })
    await controller.load()

    const first = controller.checkIn('v-a')
    const second = controller.checkIn('v-b')
    expect(ready(controller.getState()).busyVisitId).toBe('v-a')
    await Promise.all([first, second])

    expect(saved).toHaveLength(1)
    expect(visit('v-b').status).toBe('planned')
    expect(ready(controller.getState()).busyVisitId).toBeNull()
  })

  it('só age depois de carregar', async () => {
    const { controller, saved } = setup({ visits: [today({ id: 'v-a' })] })

    await controller.checkIn('v-a')

    expect(saved).toEqual([])
    expect(controller.getState().status).toBe('loading')
  })

  it('avisa quem acompanha a cada mudança, e para de avisar depois de cancelar', async () => {
    const { controller } = setup({ visits: [today({ id: 'v-a' })] })
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
    const { controller } = setup({ visits: [today({ id: 'v-a' })] })
    await controller.load()
    await controller.markNotDone('v-a', '')
    expect(ready(controller.getState()).notice).not.toBeNull()

    controller.dismissNotice()

    expect(ready(controller.getState()).notice).toBeNull()
  })

  it('dismissNotice antes de carregar não faz nada', () => {
    const { controller } = setup()
    controller.dismissNotice()
    expect(controller.getState().status).toBe('loading')
  })
})
