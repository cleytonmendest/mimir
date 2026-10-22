import { describe, expect, it } from 'vitest'
import { createFakeAccessGateway } from '@/features/access/testing'
import { createSettingsController, type SettingsReady } from './settings-controller'

const ORIGIN = 'https://agenda.exemplo'

function world(
  settings: { mode: 'closed' | 'invite' | 'open'; inviteCode: string | null } = {
    mode: 'closed',
    inviteCode: null,
  },
) {
  const fake = createFakeAccessGateway({ settings })
  const controller = createSettingsController({ gateway: fake.gateway, origin: ORIGIN })
  const ready = (): SettingsReady => {
    const state = controller.getState()
    if (state.status !== 'ready') throw new Error(`esperava ready, veio ${state.status}`)
    return state
  }
  return { ...fake, controller, ready }
}

describe('carregar', () => {
  it('começa fechado, sem código nem link', async () => {
    const { controller, ready } = world()
    await controller.start()
    expect(ready()).toMatchObject({
      settings: { mode: 'closed', inviteCode: null },
      inviteUrl: null,
    })
  })

  it('com código já gerado, monta o link de convite', async () => {
    const { controller, ready } = world({ mode: 'invite', inviteCode: 'K7QD4MXA' })
    await controller.start()
    expect(ready().inviteUrl).toBe('https://agenda.exemplo/cadastro?codigo=K7QD-4MXA')
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
    controller.askRegenerate()
    controller.keepCode()
    controller.dismissNotice()
    await controller.setMode('open')
    await controller.regenerate()
    expect(controller.getState()).toEqual({ status: 'loading' })
    expect(state.calls).toEqual([])
  })
})

describe('mudar o modo', () => {
  it('abrir o modo com código cria o código e o link', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.setMode('invite')
    expect(ready().settings.mode).toBe('invite')
    expect(ready().settings.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(ready().inviteUrl).toContain('/cadastro?codigo=')
    expect(ready().notice).toMatchObject({ kind: 'success' })
  })

  it('cada modo tem o seu aviso', async () => {
    const { controller, ready } = world()
    await controller.start()
    await controller.setMode('open')
    expect(ready().notice?.text).toMatch(/Cadastro livre ligado/)
    await controller.setMode('closed')
    expect(ready().notice?.text).toMatch(/fechado/)
  })

  it('escolher o modo que já está ligado não chama o servidor', async () => {
    const { controller, state } = world()
    await controller.start()
    const before = state.calls.length
    await controller.setMode('closed')
    expect(state.calls.length).toBe(before)
  })

  it('recusa e falha de rede viram aviso de erro', async () => {
    const { controller, ready, state, gateway } = world()
    await controller.start()
    gateway.setSignupMode = () => Promise.resolve({ ok: false, code: 'FORBIDDEN' })
    await controller.setMode('open')
    expect(ready().notice).toMatchObject({
      kind: 'error',
      text: 'Só o administrador pode mudar isso.',
    })
    state.fail = 'NETWORK'
    gateway.setSignupMode = (mode) =>
      state.fail ? Promise.reject(new Error('x')) : world().gateway.setSignupMode(mode)
    await controller.setMode('invite')
    expect(ready().notice?.kind).toBe('error')
    expect(ready().busy).toBe(false)
  })
})

describe('gerar novo código', () => {
  it('pede confirmação, gera e troca o código e o link', async () => {
    const { controller, ready } = world({ mode: 'invite', inviteCode: 'K7QD4MXA' })
    await controller.start()
    controller.askRegenerate()
    expect(ready().confirmingRegenerate).toBe(true)
    await controller.regenerate()
    expect(ready().confirmingRegenerate).toBe(false)
    expect(ready().settings.inviteCode).not.toBe('K7QD4MXA')
    expect(ready().inviteUrl).toContain(`codigo=${ready().settings.inviteCode?.slice(0, 4)}`)
    expect(ready().notice?.text).toMatch(/anterior deixou de valer/)
  })

  it('voltar da confirmação mantém o código', async () => {
    const { controller, ready, state } = world({ mode: 'invite', inviteCode: 'K7QD4MXA' })
    await controller.start()
    const before = state.calls.length
    controller.askRegenerate()
    controller.keepCode()
    expect(ready().confirmingRegenerate).toBe(false)
    expect(state.calls.length).toBe(before)
  })

  it('trocar o modo fecha uma confirmação aberta', async () => {
    const { controller, ready } = world({ mode: 'invite', inviteCode: 'K7QD4MXA' })
    await controller.start()
    controller.askRegenerate()
    await controller.setMode('open')
    expect(ready().confirmingRegenerate).toBe(false)
  })

  it('recusa e falha viram aviso', async () => {
    const { controller, ready, gateway, state } = world({ mode: 'invite', inviteCode: 'K7QD4MXA' })
    await controller.start()
    gateway.regenerateInviteCode = () => Promise.resolve({ ok: false, code: 'FORBIDDEN' })
    controller.askRegenerate()
    await controller.regenerate()
    expect(ready().notice?.kind).toBe('error')
    expect(ready().confirmingRegenerate).toBe(false)
    gateway.regenerateInviteCode = () => Promise.reject(new Error('x'))
    state.fail = null
    await controller.regenerate()
    expect(ready().notice?.kind).toBe('error')
    expect(ready().busy).toBe(false)
  })
})

describe('inscrição', () => {
  it('avisa a cada mudança e para depois de cancelar', async () => {
    const { controller } = world()
    let heard = 0
    const stop = controller.subscribe(() => {
      heard += 1
    })
    await controller.start()
    const afterStart = heard
    stop()
    controller.askRegenerate()
    expect(heard).toBe(afterStart)
  })
})
