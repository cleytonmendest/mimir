import { describe, expect, it, vi } from 'vitest'
import { createFakeBookingGateway, market } from '@/features/booking/testing'
import { createAgendaController, UPCOMING_COUNT, type AgendaReady } from './agenda-controller'

const TODAY = '2026-10-21'
const NOW = () => new Date('2026-10-21T15:00:00Z')

function world() {
  const fake = createFakeBookingGateway({
    actor: { id: 'u-lia', role: 'admin' },
    today: TODAY,
    markets: [
      market('m-a', 'Mercado A', 3),
      market('m-b', 'Mercado B', 2),
      market('m-c', 'Antigo', 3, true),
    ],
    bookings: [
      { id: 'b1', marketId: 'm-a', day: '2026-10-23', supplierId: 'u-bia' },
      { id: 'b2', marketId: 'm-a', day: '2026-10-23', supplierId: 'u-caio' },
      { id: 'b3', marketId: 'm-a', day: '2026-10-24', supplierId: 'u-dora' },
      { id: 'b4', marketId: 'm-b', day: '2026-10-28', supplierId: 'u-bia' },
    ],
    closed: [{ marketId: 'm-a', day: '2026-10-26', reason: 'Inventário' }],
    names: { 'u-bia': 'Biscoitos Dona Bia', 'u-caio': 'Café do Caio', 'u-dora': 'Doces da Dora' },
  })
  const controller = createAgendaController({ gateway: fake.gateway, now: NOW })
  const ready = (): AgendaReady => {
    const state = controller.getState()
    if (state.status !== 'ready') throw new Error(`esperava ready, veio ${state.status}`)
    return state
  }
  const dayOf = (day: string) => ready().availability?.days.find((entry) => entry.day === day)
  return { ...fake, controller, ready, dayOf }
}

describe('carregar', () => {
  it('abre com os mercados ativos, o calendário e as datas fechadas do primeiro, e todas as reservas com nome', async () => {
    const { controller, ready, dayOf } = world()
    await controller.start()
    expect(ready().markets.map((entry) => entry.name)).toEqual(['Mercado A', 'Mercado B'])
    expect(ready().marketId).toBe('m-a')
    expect(dayOf('2026-10-23')).toMatchObject({ booked: 2 })
    expect(ready().closedDays).toEqual([{ day: '2026-10-26', reason: 'Inventário' }])
    expect(ready().upcoming.map((entry) => entry.supplierName)).toEqual([
      'Biscoitos Dona Bia',
      'Café do Caio',
      'Doces da Dora',
      'Biscoitos Dona Bia',
    ])
  })

  it('sem sinal falha com a mensagem certa', async () => {
    const { controller, state } = world()
    state.fail = 'NETWORK'
    await controller.start()
    expect(controller.getState()).toMatchObject({ status: 'failed' })
  })

  it('sem mercado ativo não escolhe nada e as ações não quebram', async () => {
    const fake = createFakeBookingGateway({
      actor: { id: 'u-lia', role: 'admin' },
      today: TODAY,
      markets: [market('m-c', 'Antigo', 3, true)],
    })
    const controller = createAgendaController({ gateway: fake.gateway, now: NOW })
    await controller.start()
    expect(controller.getState()).toMatchObject({ status: 'ready', marketId: null })
    await controller.selectDay('2026-10-24')
    await controller.toggleClosed()
    await controller.refresh()
    expect(fake.closed).toHaveLength(0)
  })

  it('ações antes de carregar não fazem nada', async () => {
    const { controller } = world()
    await controller.selectDay('2026-10-24')
    controller.setCloseReason('x')
    controller.askCancel('b1')
    controller.setCancelReason('x')
    controller.keepBooking()
    controller.changeMonth({ year: 2026, month: 11 })
    controller.dismissNotice()
    await controller.toggleClosed()
    await controller.confirmCancel()
    await controller.selectMarket('m-b')
    expect(controller.getState()).toEqual({ status: 'loading' })
  })

  it('o calendário que falha mostra o motivo', async () => {
    const { gateway } = world()
    const controller = createAgendaController({
      gateway: {
        ...gateway,
        availability: () => Promise.resolve({ ok: false, code: 'MARKET_NOT_FOUND' }),
      },
      now: NOW,
    })
    await controller.start()
    expect(controller.getState()).toMatchObject({
      availability: null,
      availabilityError: 'Não foi possível mostrar este mercado.',
    })
  })

  it('o calendário que dá erro de rede mostra a mensagem de rede', async () => {
    const { gateway } = world()
    const controller = createAgendaController({
      gateway: {
        ...gateway,
        closedDays: () => Promise.reject(new Error('quebrou')),
      },
      now: NOW,
    })
    await controller.start()
    expect(controller.getState()).toMatchObject({
      availabilityError: 'Algo deu errado. Tente de novo.',
    })
  })
})

describe('escolher mercado, mês e dia', () => {
  it('trocar de mercado carrega o dele e esquece o dia', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.selectDay('2026-10-23')
    await controller.selectMarket('m-b')
    expect(ready()).toMatchObject({ marketId: 'm-b', selectedDay: null, closedDays: [] })
    expect(ready().availability?.capacity).toBe(2)
    const before = ready().availability
    await controller.selectMarket('m-b')
    expect(ready().availability).toBe(before)
  })

  it('a resposta de um mercado que chegou depois de trocar de mercado não vale', async () => {
    const { gateway } = world()
    let release: () => void = () => undefined
    const controller = createAgendaController({
      gateway: {
        ...gateway,
        availability: async (marketId, from, to) => {
          if (marketId === 'm-a') await new Promise<void>((resolve) => (release = resolve))
          return gateway.availability(marketId, from, to)
        },
      },
      now: NOW,
    })
    const starting = controller.start()
    await vi.waitFor(() => {
      expect(controller.getState()).toMatchObject({ status: 'ready' })
    })
    await controller.selectMarket('m-b')
    release()
    await starting
    expect(controller.getState()).toMatchObject({ marketId: 'm-b', availability: { capacity: 2 } })
  })

  it('só navega entre os meses que têm dia reservável', async () => {
    const { controller, ready } = world()
    await controller.start()
    controller.changeMonth({ year: 2026, month: 9 })
    controller.changeMonth({ year: 2027, month: 2 })
    expect(ready().month).toEqual({ year: 2026, month: 10 })
    controller.changeMonth({ year: 2026, month: 12 })
    expect(ready().month).toEqual({ year: 2026, month: 12 })
  })

  it('escolher outro dia limpa o motivo digitado e a pergunta de cancelamento', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.selectDay('2026-10-23')
    controller.setCloseReason('Feriado')
    controller.askCancel('b1')
    await controller.selectDay('2026-10-24')
    expect(ready()).toMatchObject({ closeReason: '', cancelling: null })
  })
})

describe('fechar e liberar datas', () => {
  it('fecha o dia com o motivo, avisa que as reservas já feitas continuam, e o calendário mostra fechado', async () => {
    const { controller, ready, dayOf, closed } = world()
    await controller.start()
    await controller.selectDay('2026-10-23') // já tem 2 reservas
    controller.setCloseReason('  Dedetização  ')

    await controller.toggleClosed()

    expect(closed).toContainEqual({ marketId: 'm-a', day: '2026-10-23', reason: 'Dedetização' })
    expect(ready().notice).toMatchObject({
      kind: 'success',
      text: 'Dia fechado para novas reservas. 2 reservas já feitas continuam valendo.',
    })
    expect(dayOf('2026-10-23')).toMatchObject({ closed: true, booked: 2 })
    expect(ready().closedDays.map((entry) => entry.day)).toEqual(['2026-10-23', '2026-10-26'])
    expect(ready().closeReason).toBe('')
  })

  it('fecha um dia sem reservas e sem motivo', async () => {
    const { controller, ready, closed } = world()
    await controller.start()
    await controller.selectDay('2026-10-27')
    await controller.toggleClosed()
    expect(closed).toContainEqual({ marketId: 'm-a', day: '2026-10-27', reason: null })
    expect(ready().notice?.text).toBe('Dia fechado para novas reservas.')
  })

  it('com uma reserva só, o aviso fica no singular', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.selectDay('2026-10-24')
    await controller.toggleClosed()
    expect(ready().notice?.text).toBe(
      'Dia fechado para novas reservas. 1 reserva já feita continua valendo.',
    )
  })

  it('libera um dia que estava fechado', async () => {
    const { controller, ready, dayOf, closed } = world()
    await controller.start()
    await controller.selectDay('2026-10-26')
    await controller.toggleClosed()
    expect(closed).toHaveLength(0)
    expect(ready().notice).toMatchObject({ kind: 'success', text: 'Dia liberado para reservas.' })
    expect(dayOf('2026-10-26')).toMatchObject({ closed: false })
  })

  it('sem dia escolhido ou com uma ação no ar, não faz nada', async () => {
    const { controller, state } = world()
    await controller.start()
    await controller.toggleClosed()
    await controller.selectDay('2026-10-27')
    await Promise.all([controller.toggleClosed(), controller.toggleClosed()])
    expect(state.calls.filter((call) => call === 'closeDay')).toHaveLength(1)
  })

  it('falha de rede ao fechar avisa', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    await controller.selectDay('2026-10-27')
    state.fail = 'NETWORK'
    await controller.toggleClosed()
    expect(ready()).toMatchObject({ busy: false })
    expect(ready().notice).toMatchObject({
      kind: 'error',
      text: expect.stringContaining('Sem conexão'),
    })
  })
})

describe('cancelar uma reserva', () => {
  it('pergunta, pede o motivo, cancela e avisa que o fornecedor não é notificado', async () => {
    const { controller, ready, dayOf, bookings } = world()
    await controller.start()
    controller.askCancel('b1')
    controller.setCancelReason('  Fornecedor avisou que não vem  ')
    expect(ready().cancelling).toEqual({ id: 'b1', reason: '  Fornecedor avisou que não vem  ' })

    await controller.confirmCancel()

    expect(bookings.find((entry) => entry.id === 'b1')).toMatchObject({
      cancelled: true,
      cancelReason: 'Fornecedor avisou que não vem',
    })
    expect(ready().notice).toMatchObject({
      kind: 'success',
      text: 'Reserva cancelada. O sistema não avisa o fornecedor: combine com ele.',
    })
    expect(ready().upcoming.some((entry) => entry.id === 'b1')).toBe(false)
    expect(dayOf('2026-10-23')).toMatchObject({ booked: 1 })
    expect(ready().cancelling).toBeNull()
  })

  it('o motivo é opcional', async () => {
    const { controller, bookings } = world()
    await controller.start()
    controller.askCancel('b3')
    await controller.confirmCancel()
    expect(bookings.find((entry) => entry.id === 'b3')).toMatchObject({
      cancelled: true,
      cancelReason: null,
    })
  })

  it('"Manter" desiste, e digitar o motivo sem ter perguntado não faz nada', async () => {
    const { controller, ready } = world()
    await controller.start()
    controller.setCancelReason('x')
    expect(ready().cancelling).toBeNull()
    controller.askCancel('b1')
    controller.keepBooking()
    expect(ready().cancelling).toBeNull()
    await controller.confirmCancel()
    expect(ready().notice).toBeNull()
  })

  it('reserva que já não existe vira mensagem clara', async () => {
    const { controller, ready, bookings } = world()
    await controller.start()
    bookings.splice(0, 1)
    controller.askCancel('b1')
    await controller.confirmCancel()
    expect(ready().notice).toMatchObject({
      kind: 'error',
      text: 'Não encontramos essa reserva. Ela pode já ter sido cancelada.',
    })
  })

  it('falha de rede ao cancelar avisa e a tela segue usável', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    controller.askCancel('b1')
    state.fail = 'NETWORK'
    await controller.confirmCancel()
    expect(ready()).toMatchObject({ busy: false, cancelling: null })
    expect(ready().notice?.kind).toBe('error')
  })
})

describe('atualizar e avisos', () => {
  it('atualizar mostra o que mudou no servidor', async () => {
    const { controller, ready, occupy } = world()
    await controller.start()
    occupy('m-a', '2026-10-27', 'u-bia')
    await controller.refresh()
    expect(ready().upcoming.filter((entry) => entry.day === '2026-10-27')).toHaveLength(1)
  })

  it('atualizar sem sinal avisa em vez de falhar calado', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    state.fail = 'NETWORK'
    await controller.refresh()
    expect(ready().notice?.kind).toBe('error')
  })

  it('o aviso some quando a pessoa o fecha, e quem assina é avisado', async () => {
    const { controller, ready } = world()
    const listener = vi.fn()
    const stop = controller.subscribe(listener)
    await controller.start()
    await controller.selectDay('2026-10-27')
    await controller.toggleClosed()
    expect(ready().notice).not.toBeNull()
    controller.dismissNotice()
    expect(ready().notice).toBeNull()
    const calls = listener.mock.calls.length
    stop()
    await controller.selectDay('2026-10-28')
    expect(listener.mock.calls.length).toBe(calls)
  })
})

describe('reservas de um dia e próximas reservas (o servidor corta listas em 1.000 linhas)', () => {
  it('as próximas reservas pedem só as primeiras, não tudo', async () => {
    const { controller, gateway } = world()
    const spy = vi.spyOn(gateway, 'adminBookings')
    await controller.start()
    expect(spy).toHaveBeenCalledWith({ from: TODAY, limit: UPCOMING_COUNT })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('escolher um dia pede só as reservas daquele mercado e dia', async () => {
    const { controller, ready, gateway } = world()
    await controller.start()
    const spy = vi.spyOn(gateway, 'adminBookings')
    await controller.selectDay('2026-10-23')
    expect(spy).toHaveBeenCalledWith({ from: '2026-10-23', to: '2026-10-23', marketId: 'm-a' })
    expect(ready().dayBookings?.map((entry) => entry.supplierName)).toEqual([
      'Biscoitos Dona Bia',
      'Café do Caio',
    ])
    await controller.selectDay('2026-10-22')
    expect(ready().dayBookings).toEqual([])
  })

  it('enquanto carrega, o dia aparece como carregando, e sem dia escolhido não há lista', async () => {
    const { controller, ready } = world()
    await controller.start()
    expect(ready().dayBookings).toBeNull()
    const loading = controller.selectDay('2026-10-23')
    expect(ready().dayBookings).toBeNull()
    await loading
    expect(ready().dayBookings).toHaveLength(2)
  })

  it('um dia distante continua mostrando quem reservou mesmo com o teto de linhas do servidor', async () => {
    const { controller, ready, state, occupy } = world()
    // Muitas reservas cedo, que sozinhas já estourariam o teto; o dia distante vem depois.
    for (let index = 0; index < 6; index += 1) occupy('m-b', '2026-10-22', `u-forn-${index}`)
    occupy('m-a', '2026-12-10', 'u-caio')
    state.maxRows = 5
    await controller.start()
    expect(ready().upcoming).toHaveLength(UPCOMING_COUNT > 5 ? 5 : UPCOMING_COUNT)
    await controller.selectDay('2026-12-10')
    expect(ready().dayBookings?.map((entry) => entry.supplierName)).toEqual(['Café do Caio'])
  })

  it('trocar de mercado limpa o dia e ignora a resposta atrasada do anterior', async () => {
    const { controller, ready, gateway } = world()
    await controller.start()
    let release: () => void = () => undefined
    const original = gateway.adminBookings.bind(gateway)
    gateway.adminBookings = async (filter) => {
      await new Promise<void>((resolve) => {
        release = resolve
      })
      return original(filter)
    }
    const slow = controller.selectDay('2026-10-23')
    await controller.selectMarket('m-b')
    expect(ready().selectedDay).toBeNull()
    release()
    await slow
    expect(ready().dayBookings).toBeNull()
  })

  it('atualizar recarrega também o dia escolhido', async () => {
    const { controller, ready, occupy } = world()
    await controller.start()
    await controller.selectDay('2026-10-24')
    expect(ready().dayBookings).toHaveLength(1)
    occupy('m-a', '2026-10-24', 'u-bia')
    await controller.refresh()
    expect(ready().dayBookings).toHaveLength(2)
  })

  it('cancelar tira a reserva da lista do dia escolhido', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.selectDay('2026-10-23')
    controller.askCancel('b1')
    await controller.confirmCancel()
    expect(ready().dayBookings?.map((entry) => entry.id)).toEqual(['b2'])
  })

  it('falha ao buscar o dia vira erro na lista, e escolher de novo limpa', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    state.fail = 'NETWORK'
    await controller.selectDay('2026-10-23')
    expect(ready().dayError).toMatch(/Sem conexão/)
    expect(ready().dayBookings).toBeNull()
    state.fail = null
    await controller.selectDay('2026-10-23')
    expect(ready().dayError).toBeNull()
    expect(ready().dayBookings).toHaveLength(2)
  })

  it('atualizar sem dia escolhido não busca reservas de dia', async () => {
    const { controller, gateway } = world()
    await controller.start()
    const spy = vi.spyOn(gateway, 'adminBookings')
    await controller.refresh()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ from: TODAY, limit: UPCOMING_COUNT })
  })

  it('ações antes de carregar não fazem nada com o dia', async () => {
    const { controller } = world()
    await controller.selectDay('2026-10-23')
    expect(controller.getState()).toEqual({ status: 'loading' })
  })
})
