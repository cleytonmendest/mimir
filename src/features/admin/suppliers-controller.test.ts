import { describe, expect, it } from 'vitest'
import { createFakeAccessGateway, supplier } from '@/features/access/testing'
import { createSuppliersController, type SuppliersReady } from './suppliers-controller'

const ORIGIN = 'https://agenda.exemplo'

function world() {
  const fake = createFakeAccessGateway({
    suppliers: [
      supplier('u-bia', 'Biscoitos Bia'),
      supplier('u-ana', 'Ana Doces'),
      supplier('u-zed', 'Zé', false),
    ],
    futureBookings: { 'u-bia': 2, 'u-ana': 1 },
  })
  const controller = createSuppliersController({ gateway: fake.gateway, origin: ORIGIN })
  const ready = (): SuppliersReady => {
    const state = controller.getState()
    if (state.status !== 'ready') throw new Error(`esperava ready, veio ${state.status}`)
    return state
  }
  const names = () => ready().suppliers.map((entry) => entry.fullName)
  return { ...fake, controller, ready, names }
}

describe('carregar', () => {
  it('lista os ativos primeiro, cada grupo por nome', async () => {
    const { controller, names } = world()
    await controller.start()
    expect(names()).toEqual(['Ana Doces', 'Biscoitos Bia', 'Zé'])
  })

  it('sem sinal falha, e dá para tentar de novo', async () => {
    const { controller, state } = world()
    state.fail = 'NETWORK'
    await controller.start()
    expect(controller.getState()).toMatchObject({ status: 'failed' })
    state.fail = null
    await controller.start()
    expect(controller.getState().status).toBe('ready')
  })

  it('ações antes de carregar não fazem nada', async () => {
    const { controller, state } = world()
    controller.askDeactivate('u-ana')
    controller.keepActive()
    controller.dismissOffer()
    controller.dismissNotice()
    expect(await controller.create({ fullName: 'X', email: 'x@y.com' })).toBe(false)
    await controller.issueLink('u-ana')
    await controller.setActive('u-ana', false)
    expect(controller.getState()).toEqual({ status: 'loading' })
    expect(state.calls).toEqual([])
  })
})

describe('cadastrar', () => {
  it('cria, entra na lista e oferece o link de ativação', async () => {
    const { controller, ready, names } = world()
    await controller.start()
    expect(await controller.create({ fullName: '  Café do Caio ', email: 'Caio@Loja.com ' })).toBe(
      true,
    )
    expect(names()).toContain('Café do Caio')
    expect(ready().suppliers.find((entry) => entry.fullName === 'Café do Caio')?.email).toBe(
      'caio@loja.com',
    )
    expect(ready().offer).toMatchObject({ supplierName: 'Café do Caio', firstAccess: true })
    expect(ready().offer?.url).toMatch(/^https:\/\/agenda\.exemplo\/definir-senha\?token=/)
    expect(ready().notice).toMatchObject({ kind: 'success' })
  })

  it('confere os dados antes de ir ao servidor', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    const before = state.calls.length
    expect(await controller.create({ fullName: '', email: 'x@y.com' })).toBe(false)
    expect(ready().formError).toBe('Informe o nome do fornecedor.')
    expect(await controller.create({ fullName: 'X', email: 'torto' })).toBe(false)
    expect(ready().formError).toMatch(/não parece certo/)
    expect(state.calls.length).toBe(before)
  })

  it('e-mail repetido volta como erro do formulário', async () => {
    const { controller, ready } = world()
    await controller.start()
    expect(await controller.create({ fullName: 'Outra', email: 'u-ana@loja.com' })).toBe(false)
    expect(ready().formError).toMatch(/Já existe uma conta/)
    expect(ready().offer).toBeNull()
  })

  it('mensagem do servidor para dados inválidos aparece no formulário', async () => {
    const { controller, ready, gateway } = world()
    await controller.start()
    gateway.createSupplier = () =>
      Promise.resolve({ ok: false, code: 'INVALID_INPUT', message: 'O servidor não gostou.' })
    expect(await controller.create({ fullName: 'X', email: 'x@y.com' })).toBe(false)
    expect(ready().formError).toBe('O servidor não gostou.')
  })

  it('falha de rede vira aviso, sem perder o formulário', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    state.fail = 'NETWORK'
    expect(await controller.create({ fullName: 'X', email: 'x@y.com' })).toBe(false)
    expect(ready().notice).toMatchObject({ kind: 'error' })
    expect(ready().busy).toBe(false)
  })
})

describe('novo link', () => {
  it('gera outro link para quem perdeu o acesso', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.issueLink('u-ana')
    expect(ready().offer).toMatchObject({ supplierName: 'Ana Doces', firstAccess: false })
    controller.dismissOffer()
    expect(ready().offer).toBeNull()
  })

  it('desativado não recebe link', async () => {
    const { controller, ready, gateway } = world()
    await controller.start()
    // O fornecedor foi desativado por outra aba depois de a lista carregar.
    await gateway.setSupplierActive('u-ana', false)
    await controller.issueLink('u-ana')
    expect(ready().offer).toBeNull()
    expect(ready().notice?.text).toMatch(/está desativado/)
  })

  it('fornecedor que sumiu: manda atualizar a lista', async () => {
    const { controller, ready, suppliers } = world()
    await controller.start()
    suppliers.splice(0, suppliers.length)
    await controller.issueLink('u-ana')
    expect(ready().notice?.text).toMatch(/Atualize a lista/)
  })

  it('id desconhecido e falha de rede', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    const before = state.calls.length
    await controller.issueLink('u-fantasma')
    expect(state.calls.length).toBe(before)
    state.fail = 'SERVER'
    await controller.issueLink('u-ana')
    expect(ready().notice).toMatchObject({ kind: 'error' })
  })
})

describe('desativar e reativar', () => {
  it('pede confirmação, desativa e conta as reservas canceladas', async () => {
    const { controller, ready, names } = world()
    await controller.start()
    controller.askDeactivate('u-bia')
    expect(ready().confirmingDeactivate).toBe('u-bia')
    await controller.setActive('u-bia', false)
    expect(ready().confirmingDeactivate).toBeNull()
    expect(ready().notice?.text).toBe(
      'Biscoitos Bia foi desativado. 2 reservas futuras canceladas.',
    )
    expect(ready().suppliers.find((entry) => entry.id === 'u-bia')?.active).toBe(false)
    // Agora os dois desativados ficam no fim, por nome.
    expect(names()).toEqual(['Ana Doces', 'Biscoitos Bia', 'Zé'])
  })

  it('uma reserva só e nenhuma reserva', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.setActive('u-ana', false)
    expect(ready().notice?.text).toBe('Ana Doces foi desativado. 1 reserva futura cancelada.')
    await controller.setActive('u-zed', false)
    expect(ready().notice?.text).toBe('Zé foi desativado.')
  })

  it('voltar da confirmação não muda nada', async () => {
    const { controller, ready, state } = world()
    await controller.start()
    const before = state.calls.length
    controller.askDeactivate('u-bia')
    controller.keepActive()
    expect(ready().confirmingDeactivate).toBeNull()
    expect(state.calls.length).toBe(before)
  })

  it('reativa', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.setActive('u-zed', true)
    expect(ready().suppliers.find((entry) => entry.id === 'u-zed')?.active).toBe(true)
    expect(ready().notice?.text).toBe('Zé foi reativado e já pode entrar.')
  })

  it('desativar quem acabou de ganhar link tira o link da tela', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.issueLink('u-ana')
    expect(ready().offer).not.toBeNull()
    await controller.setActive('u-ana', false)
    expect(ready().offer).toBeNull()
    // O link de outra pessoa continua.
    await controller.issueLink('u-bia')
    await controller.setActive('u-zed', true)
    expect(ready().offer).not.toBeNull()
  })

  it('recusa do servidor e falha de rede viram aviso', async () => {
    const { controller, ready, state, suppliers } = world()
    await controller.start()
    suppliers.splice(0, suppliers.length)
    await controller.setActive('u-ana', false)
    expect(ready().notice?.text).toMatch(/Atualize a lista/)
    state.fail = 'NETWORK'
    await controller.setActive('u-bia', false)
    expect(ready().notice?.text).toMatch(/Sem conexão/)
    expect(ready().busy).toBe(false)
  })

  it('id desconhecido não faz nada', async () => {
    const { controller, state } = world()
    await controller.start()
    const before = state.calls.length
    await controller.setActive('u-fantasma', false)
    expect(state.calls.length).toBe(before)
  })
})

describe('inscrição', () => {
  it('avisa quem acompanha a cada mudança, e para depois de cancelar', async () => {
    const { controller } = world()
    let heard = 0
    const stop = controller.subscribe(() => {
      heard += 1
    })
    await controller.start()
    const afterStart = heard
    expect(afterStart).toBeGreaterThan(0)
    stop()
    controller.askDeactivate('u-ana')
    expect(heard).toBe(afterStart)
  })
})
