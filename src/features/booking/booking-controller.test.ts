import { describe, expect, it, vi } from 'vitest'
import { RequestFailure } from '@/lib/supabase/errors'
import { createBookingController, type ReadyState } from './booking-controller'
import { createFakeBookingGateway, market } from './testing'

const TODAY = '2026-10-21'
const NOW = () => new Date('2026-10-21T15:00:00Z')
const ana = { id: 'u-ana', role: 'supplier' as const }

function world() {
  const fake = createFakeBookingGateway({
    actor: ana,
    today: TODAY,
    markets: [
      market('m-a', 'Mercado A', 3),
      market('m-b', 'Mercado B', 2),
      market('m-c', 'Antigo', 3, true),
    ],
    bookings: [
      { id: 'b-x1', marketId: 'm-a', day: '2026-10-23', supplierId: 'u-bia' },
      { id: 'b-x2', marketId: 'm-a', day: '2026-10-23', supplierId: 'u-caio' },
      { id: 'b-own', marketId: 'm-b', day: '2026-11-02', supplierId: 'u-ana' },
    ],
    closed: [{ marketId: 'm-a', day: '2026-10-26' }],
  })
  const controller = createBookingController({ gateway: fake.gateway, now: NOW })
  const ready = (): ReadyState => {
    const state = controller.getState()
    if (state.status !== 'ready') throw new Error(`esperava ready, veio ${state.status}`)
    return state
  }
  const dayOf = (day: string) => ready().availability?.days.find((entry) => entry.day === day)
  return { ...fake, controller, ready, dayOf }
}

describe('carregar', () => {
  it('abre com os mercados que aceitam reservas, o primeiro escolhido e o calendário dele', async () => {
    const { controller, ready, dayOf } = world()
    expect(controller.getState()).toEqual({ status: 'loading' })

    await controller.start()

    expect(ready().markets.map((entry) => entry.name)).toEqual(['Mercado A', 'Mercado B'])
    expect(ready().marketId).toBe('m-a')
    expect(ready().month).toEqual({ year: 2026, month: 10 })
    expect(ready().availability?.today).toBe(TODAY)
    expect(dayOf('2026-10-23')).toMatchObject({ booked: 2, closed: false, mine: false })
    expect(dayOf('2026-10-26')).toMatchObject({ closed: true })
    expect(ready().myBookings.map((entry) => entry.id)).toEqual(['b-own'])
  })

  it('sem sinal: falha com a mensagem certa', async () => {
    const { controller, state } = world()
    state.fail = 'NETWORK'
    await controller.start()
    expect(controller.getState()).toEqual({
      status: 'failed',
      message: 'Sem conexão com o servidor. Confira a internet e tente de novo.',
    })
  })

  it('sem nenhum mercado aberto não escolhe nada e não quebra', async () => {
    const fake = createFakeBookingGateway({
      actor: ana,
      today: TODAY,
      markets: [market('m-c', 'Antigo', 3, true)],
    })
    const controller = createBookingController({ gateway: fake.gateway, now: NOW })
    await controller.start()
    expect(controller.getState()).toMatchObject({
      status: 'ready',
      marketId: null,
      availability: null,
    })
    await controller.refresh()
    controller.selectDay('2026-10-22')
    controller.startBooking()
    await controller.confirmBooking()
    expect(fake.bookings).toHaveLength(0)
  })

  it('ações antes de carregar não fazem nada', async () => {
    const { controller, calls } = (() => {
      const w = world()
      return { controller: w.controller, calls: w.state.calls }
    })()
    controller.selectDay('2026-10-22')
    controller.startBooking()
    controller.backFromConfirm()
    controller.askCancel('b-own', 'list')
    controller.keepBooking()
    controller.dismissNotice()
    controller.changeMonth({ year: 2026, month: 11 })
    await controller.confirmBooking()
    await controller.confirmCancel()
    await controller.goToBooking('b-own')
    await controller.selectMarket('m-b')
    await controller.refresh()
    expect(controller.getState()).toEqual({ status: 'loading' })
    expect(calls).toHaveLength(1) // só o refresh, que pede ao servidor mas não tem mercado escolhido para mostrar
  })

  it('o calendário que falha mostra o motivo, sem derrubar a tela', async () => {
    const { controller, ready, gateway } = world()
    const broken = createBookingController({
      gateway: {
        ...gateway,
        availability: () => Promise.reject(new RequestFailure('SERVER', 'boom')),
      },
      now: NOW,
    })
    await broken.start()
    expect(broken.getState()).toMatchObject({
      status: 'ready',
      availability: null,
      availabilityError: 'O servidor não conseguiu atender agora. Tente de novo em instantes.',
    })
    await controller.start()
    expect(ready().availabilityError).toBeNull()
  })

  it('o servidor recusar o calendário também mostra o motivo', async () => {
    const { gateway } = world()
    const controller = createBookingController({
      gateway: {
        ...gateway,
        availability: () => Promise.resolve({ ok: false, code: 'MARKET_NOT_FOUND' }),
      },
      now: NOW,
    })
    await controller.start()
    expect(controller.getState()).toMatchObject({
      availabilityError: 'Não foi possível mostrar este mercado.',
    })
  })
})

describe('escolher mercado, mês e dia', () => {
  it('trocar de mercado carrega o calendário dele e esquece o dia escolhido', async () => {
    const { controller, ready } = world()
    await controller.start()
    controller.selectDay('2026-10-23')
    await controller.selectMarket('m-b')
    expect(ready().marketId).toBe('m-b')
    expect(ready().selectedDay).toBeNull()
    expect(ready().availability?.capacity).toBe(2)
  })

  it('escolher o mercado que já está escolhido não pede nada ao servidor', async () => {
    const { controller, state } = world()
    await controller.start()
    const before = state.calls.length
    await controller.selectMarket('m-a')
    expect(state.calls.length).toBe(before)
  })

  it('a resposta de um mercado que chegou depois de trocar para outro não vale', async () => {
    const { gateway } = world()
    let release: () => void = () => undefined
    const slow = createBookingController({
      gateway: {
        ...gateway,
        availability: async (marketId, from, to) => {
          if (marketId === 'm-a') await new Promise<void>((resolve) => (release = resolve))
          return gateway.availability(marketId, from, to)
        },
      },
      now: NOW,
    })
    const starting = slow.start()
    await vi.waitFor(() => {
      expect(slow.getState()).toMatchObject({ status: 'ready' })
    })
    await slow.selectMarket('m-b')
    release()
    await starting
    expect(slow.getState()).toMatchObject({ marketId: 'm-b', availability: { capacity: 2 } })
  })

  it('só navega entre os meses que têm dia reservável', async () => {
    const { controller, ready } = world()
    await controller.start()
    controller.changeMonth({ year: 2026, month: 9 })
    expect(ready().month).toEqual({ year: 2026, month: 10 })
    controller.changeMonth({ year: 2027, month: 1 })
    expect(ready().month).toEqual({ year: 2026, month: 10 })
    controller.changeMonth({ year: 2026, month: 12 })
    expect(ready().month).toEqual({ year: 2026, month: 12 })
  })

  it('escolher o dia e pedir para reservar abre a confirmação; voltar fecha', async () => {
    const { controller, ready } = world()
    await controller.start()
    controller.startBooking()
    expect(ready().confirming).toBe(false) // sem dia escolhido
    controller.selectDay('2026-10-24')
    controller.startBooking()
    expect(ready().confirming).toBe(true)
    controller.backFromConfirm()
    expect(ready().confirming).toBe(false)
  })

  it('escolher outro dia fecha uma confirmação que estava aberta', async () => {
    const { controller, ready } = world()
    await controller.start()
    controller.selectDay('2026-10-24')
    controller.startBooking()
    controller.selectDay('2026-10-25')
    expect(ready()).toMatchObject({ selectedDay: '2026-10-25', confirming: false })
  })
})

describe('reservar', () => {
  it('reserva, avisa e o calendário e "Minhas reservas" já mostram', async () => {
    const { controller, ready, dayOf, bookings } = world()
    await controller.start()
    controller.selectDay('2026-10-24')
    controller.startBooking()

    await controller.confirmBooking()

    expect(
      bookings.filter((entry) => entry.supplierId === 'u-ana' && entry.day === '2026-10-24'),
    ).toHaveLength(1)
    expect(ready().notice).toMatchObject({
      kind: 'success',
      text: 'Reserva confirmada: Mercado A, sábado, 24 de outubro. Ela aparece em Minhas reservas.',
    })
    expect(ready()).toMatchObject({ confirming: false, busy: false })
    expect(dayOf('2026-10-24')).toMatchObject({ booked: 1, mine: true })
    expect(ready().myBookings.map((entry) => entry.day)).toEqual(['2026-10-24', '2026-11-02'])
  })

  it('a última vaga: outro fornecedor ocupa enquanto a pessoa decide, e ela é recusada com clareza', async () => {
    const { controller, ready, dayOf, bookings, state, occupy } = world()
    await controller.start()
    controller.selectDay('2026-10-23') // já tem 2 de 3
    controller.startBooking()
    // Entre o clique e a resposta, outro fornecedor pega a última vaga.
    state.beforeBook = () => {
      occupy('m-a', '2026-10-23', 'u-dora')
    }

    await controller.confirmBooking()

    expect(
      bookings.some((entry) => entry.supplierId === 'u-ana' && entry.day === '2026-10-23'),
    ).toBe(false)
    expect(ready().notice).toMatchObject({
      kind: 'error',
      text: expect.stringContaining('a última vaga deste dia acabou de ser ocupada'),
    })
    // A tela aprende o que o servidor decidiu: dia lotado.
    expect(dayOf('2026-10-23')).toMatchObject({ booked: 3 })
    expect(ready().confirming).toBe(false)
  })

  it('dia fechado e fora da janela viram mensagens próprias', async () => {
    const { controller, ready } = world()
    await controller.start()
    controller.selectDay('2026-10-26')
    controller.startBooking()
    await controller.confirmBooking()
    expect(ready().notice?.text).toBe(
      'Este dia está fechado para reservas neste mercado. Escolha outro dia.',
    )

    controller.selectDay('2027-03-01')
    controller.startBooking()
    await controller.confirmBooking()
    expect(ready().notice?.text).toBe('Só dá para reservar de amanhã até 60 dias à frente.')
  })

  it('repetir uma reserva que já é sua avisa e não duplica', async () => {
    const { controller, ready, bookings } = world()
    await controller.start()
    await controller.selectMarket('m-b')
    controller.selectDay('2026-11-02')
    controller.startBooking()
    await controller.confirmBooking()
    expect(ready().notice).toMatchObject({
      kind: 'success',
      text: 'Você já tinha reservado este dia.',
    })
    expect(bookings.filter((entry) => entry.supplierId === 'u-ana')).toHaveLength(1)
  })

  it('falha de rede ao reservar avisa e não deixa a tela presa', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    controller.selectDay('2026-10-24')
    controller.startBooking()
    state.fail = 'NETWORK'
    await controller.confirmBooking()
    expect(ready()).toMatchObject({ busy: false, confirming: false })
    expect(ready().notice).toMatchObject({
      kind: 'error',
      text: expect.stringContaining('Sem conexão'),
    })
  })

  it('cliques repetidos enquanto uma reserva está no ar viram uma chamada só', async () => {
    const { controller, state } = world()
    await controller.start()
    controller.selectDay('2026-10-24')
    controller.startBooking()
    await Promise.all([
      controller.confirmBooking(),
      controller.confirmBooking(),
      controller.confirmBooking(),
    ])
    expect(state.calls.filter((call) => call === 'book')).toHaveLength(1)
  })
})

describe('cancelar', () => {
  it('pergunta antes, cancela, avisa e libera a vaga', async () => {
    const { controller, ready, dayOf, bookings } = world()
    await controller.start()
    await controller.selectMarket('m-b')

    controller.askCancel('b-own', 'list')
    expect(ready().cancelling).toEqual({ id: 'b-own', where: 'list' })
    await controller.confirmCancel()

    expect(bookings.find((entry) => entry.id === 'b-own')?.cancelled).toBe(true)
    expect(ready().notice).toMatchObject({
      kind: 'success',
      text: 'Reserva cancelada. A vaga voltou a ficar livre.',
    })
    expect(ready().cancelling).toBeNull()
    expect(ready().myBookings).toEqual([])
    expect(dayOf('2026-11-02')).toMatchObject({ booked: 0, mine: false })
  })

  it('"manter" desiste de cancelar', async () => {
    const { controller, ready } = world()
    await controller.start()
    controller.askCancel('b-own', 'panel')
    controller.keepBooking()
    expect(ready().cancelling).toBeNull()
  })

  it('reserva que já não existe vira mensagem clara', async () => {
    const { controller, ready, bookings } = world()
    await controller.start()
    bookings.splice(
      bookings.findIndex((entry) => entry.id === 'b-own'),
      1,
    )
    controller.askCancel('b-own', 'list')
    await controller.confirmCancel()
    expect(ready().notice).toMatchObject({
      kind: 'error',
      text: 'Não encontramos essa reserva. Ela pode já ter sido cancelada.',
    })
  })

  it('falha de rede ao cancelar avisa', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    controller.askCancel('b-own', 'list')
    state.fail = 'NETWORK'
    await controller.confirmCancel()
    expect(ready()).toMatchObject({ busy: false, cancelling: null })
    expect(ready().notice?.kind).toBe('error')
  })

  it('confirmar sem ter perguntado não cancela nada', async () => {
    const { controller, state } = world()
    await controller.start()
    await controller.confirmCancel()
    expect(state.calls).not.toContain('cancel')
  })
})

describe('Minhas reservas e atualização', () => {
  it('ir à reserva leva o calendário ao mercado, ao mês e ao dia dela', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.goToBooking('b-own')
    expect(ready()).toMatchObject({
      marketId: 'm-b',
      month: { year: 2026, month: 11 },
      selectedDay: '2026-11-02',
      availability: { capacity: 2 },
    })
  })

  it('ir a uma reserva do mercado que já está aberto não recarrega o calendário', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    await controller.selectMarket('m-b')
    const before = state.calls.length
    await controller.goToBooking('b-own')
    expect(ready().selectedDay).toBe('2026-11-02')
    expect(state.calls.length).toBe(before)
  })

  it('reserva que não está na lista é ignorada', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.goToBooking('b-fantasma')
    expect(ready().selectedDay).toBeNull()
  })

  it('atualizar mostra o que mudou no servidor', async () => {
    const { controller, dayOf, occupy } = world()
    await controller.start()
    occupy('m-a', '2026-10-27', 'u-bia')
    await controller.refresh()
    expect(dayOf('2026-10-27')).toMatchObject({ booked: 1 })
  })

  it('atualizar sem sinal avisa em vez de falhar calado', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    state.fail = 'NETWORK'
    await controller.refresh()
    expect(ready().notice?.kind).toBe('error')
  })

  it('o aviso some quando a pessoa o fecha, e quem assina é avisado de cada mudança', async () => {
    const { controller, ready } = world()
    const listener = vi.fn()
    const stop = controller.subscribe(listener)
    await controller.start()
    controller.selectDay('2026-10-24')
    controller.startBooking()
    await controller.confirmBooking()
    expect(ready().notice).not.toBeNull()
    controller.dismissNotice()
    expect(ready().notice).toBeNull()

    const calls = listener.mock.calls.length
    stop()
    controller.selectDay('2026-10-25')
    expect(listener.mock.calls.length).toBe(calls)
  })

  it('dois avisos iguais seguidos têm ids diferentes (o segundo aparece de novo)', async () => {
    const { controller, ready } = world()
    await controller.start()
    controller.selectDay('2026-10-26')
    controller.startBooking()
    await controller.confirmBooking()
    const first = ready().notice?.id
    controller.startBooking()
    await controller.confirmBooking()
    expect(ready().notice?.id).not.toBe(first)
  })
})
