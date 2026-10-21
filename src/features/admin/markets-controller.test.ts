import { describe, expect, it, vi } from 'vitest'
import { createFakeBookingGateway, market } from '@/features/booking/testing'
import { createMarketsController, type MarketsReady } from './markets-controller'

const NOW = () => new Date('2026-10-21T15:00:00Z')

function world() {
  const central = { ...market('m-a', 'Mercado Central', 3), address: 'Rua 1' }
  const fake = createFakeBookingGateway({
    actor: { id: 'u-lia', role: 'admin' },
    today: '2026-10-21',
    markets: [market('m-b', 'Mercado Bairro', 2), central, market('m-c', 'Antigo', 3, true)],
    bookings: ['u-bia', 'u-caio', 'u-dora'].map((supplierId, index) => ({
      id: `b${index}`,
      marketId: 'm-a',
      day: '2026-10-24',
      supplierId,
    })),
  })
  const controller = createMarketsController({ gateway: fake.gateway, now: NOW })
  const ready = (): MarketsReady => {
    const state = controller.getState()
    if (state.status !== 'ready') throw new Error(`esperava ready, veio ${state.status}`)
    return state
  }
  const names = () => ready().markets.map((entry) => entry.name)
  return { ...fake, controller, ready, names }
}

describe('carregar', () => {
  it('lista por nome, com os arquivados no fim', async () => {
    const { controller, names } = world()
    await controller.start()
    expect(names()).toEqual(['Mercado Bairro', 'Mercado Central', 'Antigo'])
  })

  it('sem sinal falha', async () => {
    const { controller, state } = world()
    state.fail = 'NETWORK'
    await controller.start()
    expect(controller.getState()).toMatchObject({ status: 'failed' })
  })

  it('ações antes de carregar não fazem nada', async () => {
    const { controller, state } = world()
    controller.startEdit('m-a')
    controller.cancelEdit()
    controller.askArchive('m-a')
    controller.keepActive()
    controller.dismissNotice()
    expect(await controller.create({ name: 'X', address: '', capacity: 3 })).toBe(false)
    expect(await controller.save('m-a', { name: 'X', address: '' })).toBe(false)
    await controller.setCapacity('m-a', 4)
    await controller.setArchived('m-a', true)
    expect(controller.getState()).toEqual({ status: 'loading' })
    expect(state.calls).toEqual([])
  })
})

describe('cadastrar', () => {
  it('cadastra, mostra na lista em ordem e avisa', async () => {
    const { controller, ready, names, markets } = world()
    await controller.start()
    const created = await controller.create({
      name: '  Mercado Aurora ',
      address: ' Av. 2 ',
      capacity: 4,
    })
    expect(created).toBe(true)
    expect(names()).toEqual(['Mercado Aurora', 'Mercado Bairro', 'Mercado Central', 'Antigo'])
    expect(markets.find((entry) => entry.name === 'Mercado Aurora')).toMatchObject({
      address: 'Av. 2',
      capacity: 4,
    })
    expect(ready().notice).toMatchObject({
      kind: 'success',
      text: 'Mercado Mercado Aurora cadastrado.',
    })
  })

  it('dado inválido não vai ao servidor e mostra o motivo', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    expect(await controller.create({ name: '   ', address: '', capacity: 3 })).toBe(false)
    expect(ready().formError).toBe('Informe o nome do mercado.')
    expect(state.calls).not.toContain('createMarket')
    expect(await controller.create({ name: 'Novo', address: '', capacity: 0 })).toBe(false)
    expect(ready().formError).toContain('de 1 a 20')
  })

  it('falha de rede ao cadastrar avisa', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    state.fail = 'NETWORK'
    expect(await controller.create({ name: 'Novo', address: '', capacity: 3 })).toBe(false)
    expect(ready().notice?.kind).toBe('error')
  })
})

describe('editar nome e endereço', () => {
  it('abre a edição, salva e fecha', async () => {
    const { controller, ready, names } = world()
    await controller.start()
    controller.startEdit('m-a')
    expect(ready().editing).toBe('m-a')
    expect(await controller.save('m-a', { name: ' Central Renovado ', address: '' })).toBe(true)
    expect(ready()).toMatchObject({ editing: null, notice: { text: 'Mercado atualizado.' } })
    expect(names()).toContain('Central Renovado')
    expect(ready().markets.find((entry) => entry.id === 'm-a')?.address).toBeNull()
  })

  it('cancelar a edição fecha o formulário e some o erro', async () => {
    const { controller, ready } = world()
    await controller.start()
    controller.startEdit('m-a')
    expect(await controller.save('m-a', { name: '', address: '' })).toBe(false)
    expect(ready().formError).toBe('Informe o nome do mercado.')
    controller.cancelEdit()
    expect(ready()).toMatchObject({ editing: null, formError: null })
  })

  it('salvar um mercado que não existe na lista é ignorado; falha de rede avisa', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    expect(await controller.save('m-x', { name: 'Y', address: '' })).toBe(false)
    state.fail = 'NETWORK'
    expect(await controller.save('m-a', { name: 'Y', address: '' })).toBe(false)
    expect(ready().notice?.kind).toBe('error')
  })
})

describe('limite de estandes', () => {
  it('aumentar atualiza e avisa', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.setCapacity('m-b', 5)
    expect(ready().markets.find((entry) => entry.id === 'm-b')?.capacity).toBe(5)
    expect(ready().notice).toMatchObject({
      kind: 'info',
      text: 'Limite de Mercado Bairro: 5 estandes por dia.',
    })
  })

  it('reduzir abaixo do que já está reservado avisa que nada é cancelado', async () => {
    const { controller, ready, bookings } = world()
    await controller.start()
    await controller.setCapacity('m-a', 2) // sábado 24 já tem 3 reservas
    expect(ready().notice?.text).toBe(
      'Limite de Mercado Central: 2 estandes por dia. Sábado, 24 de outubro já tem 3 reservas: os dias que passam do limite novo continuam como estão, só as reservas novas respeitam.',
    )
    expect(bookings.every((entry) => entry.cancelled !== true)).toBe(true)
  })

  it('reduzir sem conflito é só o aviso do limite, no singular quando é 1', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.setCapacity('m-b', 1)
    expect(ready().notice?.text).toBe('Limite de Mercado Bairro: 1 estande por dia.')
  })

  it('o mesmo valor ou fora de 1 a 20 não chama o servidor', async () => {
    const { controller, state } = world()
    await controller.start()
    const before = state.calls.length
    await controller.setCapacity('m-a', 3)
    await controller.setCapacity('m-a', 0)
    await controller.setCapacity('m-a', 21)
    await controller.setCapacity('m-x', 4)
    expect(state.calls.length).toBe(before)
  })

  it('falha de rede avisa e o limite não muda na tela', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    state.fail = 'NETWORK'
    await controller.setCapacity('m-a', 4)
    expect(ready().markets.find((entry) => entry.id === 'm-a')?.capacity).toBe(3)
    expect(ready().notice?.kind).toBe('error')
  })
})

describe('arquivar', () => {
  it('pergunta antes, arquiva, e o mercado vai para o fim da lista', async () => {
    const { controller, ready, names } = world()
    await controller.start()
    controller.askArchive('m-b')
    expect(ready().confirmingArchive).toBe('m-b')
    await controller.setArchived('m-b', true)
    expect(ready().confirmingArchive).toBeNull()
    expect(names()).toEqual(['Mercado Central', 'Antigo', 'Mercado Bairro'])
    expect(ready().notice?.text).toContain(
      'Não aceita novas reservas; as que já existem continuam.',
    )
  })

  it('"Manter" desiste, e reativar devolve o mercado', async () => {
    const { controller, ready, names } = world()
    await controller.start()
    controller.askArchive('m-b')
    controller.keepActive()
    expect(ready().confirmingArchive).toBeNull()
    await controller.setArchived('m-c', false)
    expect(names()).toEqual(['Antigo', 'Mercado Bairro', 'Mercado Central'])
    expect(ready().notice?.text).toBe('Antigo voltou a aceitar reservas.')
  })

  it('falha de rede avisa', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    state.fail = 'NETWORK'
    await controller.setArchived('m-b', true)
    expect(ready().notice?.kind).toBe('error')
  })

  it('o aviso some quando a pessoa o fecha, e quem assina é avisado', async () => {
    const { controller, ready } = world()
    const listener = vi.fn()
    const stop = controller.subscribe(listener)
    await controller.start()
    await controller.setCapacity('m-b', 4)
    controller.dismissNotice()
    expect(ready().notice).toBeNull()
    const calls = listener.mock.calls.length
    stop()
    controller.startEdit('m-a')
    expect(listener.mock.calls.length).toBe(calls)
  })
})
