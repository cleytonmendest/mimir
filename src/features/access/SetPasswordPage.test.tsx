import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthFailure } from '@/lib/supabase/auth'
import { createFakeGateway, type FakeAccount } from '@/features/auth/testing'
import { SetPasswordPage } from './SetPasswordPage'

const nova: FakeAccount = {
  userId: 'u-nova',
  password: 'sem-senha-ainda',
  profile: { id: 'u-nova', role: 'supplier', fullName: 'Loja Nova', active: true },
}
const PASSWORD = 'uma-senha-bem-longa'

function setup(token: string | null = 'tok-1') {
  const auth = createFakeGateway({
    accounts: { 'nova@loja.com': nova },
    activationTokens: { 'tok-1': 'nova@loja.com' },
  })
  const onDone = vi.fn()
  const user = userEvent.setup()
  render(<SetPasswordPage auth={auth} token={token} onDone={onDone} />)
  return { auth, onDone, user }
}

afterEach(() => {
  cleanup()
})

describe('o link vale', () => {
  it('só gasta o link depois do toque em Definir minha senha', async () => {
    const { auth, user } = setup()
    const redeem = vi.spyOn(auth, 'redeemActivationToken')
    expect(screen.getByRole('heading', { name: 'Defina a sua senha' })).toBeInTheDocument()
    expect(redeem).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Definir minha senha' }))

    expect(redeem).toHaveBeenCalledWith('tok-1')
    expect(await screen.findByLabelText('Escolha a sua senha')).toBeInTheDocument()
  })

  it('define a senha e segue para o app', async () => {
    const { onDone, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Definir minha senha' }))
    await user.type(await screen.findByLabelText('Escolha a sua senha'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Salvar senha e entrar' }))

    expect(await screen.findByText('Senha definida. Entrando…')).toBeInTheDocument()
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(nova.password).toBe(PASSWORD)
  })

  it('o botão Mostrar revela a senha digitada', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Definir minha senha' }))
    const field = await screen.findByLabelText('Escolha a sua senha')
    await user.type(field, 'abc')
    expect(field).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Mostrar' }))
    expect(field).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Ocultar' }))
    expect(field).toHaveAttribute('type', 'password')
  })
})

describe('o link não vale', () => {
  it('sem token (link cortado)', () => {
    setup(null)
    expect(screen.getByRole('alert')).toHaveTextContent('venceu ou já foi usado')
    expect(screen.queryByRole('button', { name: 'Definir minha senha' })).not.toBeInTheDocument()
  })

  it('token desconhecido, vencido ou já usado', async () => {
    const { user } = setup('tok-velho')
    await user.click(screen.getByRole('button', { name: 'Definir minha senha' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('venceu ou já foi usado')
  })

  it('o mesmo link não abre duas vezes', async () => {
    const first = setup()
    await first.user.click(screen.getByRole('button', { name: 'Definir minha senha' }))
    await screen.findByLabelText('Escolha a sua senha')
    // Segunda visita ao mesmo link, no mesmo servidor.
    const again = await first.auth.redeemActivationToken('tok-1')
    expect(again).toBe('INVALID_LINK')
  })
})

describe('erros ao longo do caminho', () => {
  it('sem internet ao abrir o link: não diz que venceu, deixa tentar de novo', async () => {
    const { auth, user } = setup()
    auth.setFault('offline')
    await user.click(screen.getByRole('button', { name: 'Definir minha senha' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão')
    auth.setFault(null)
    await user.click(screen.getByRole('button', { name: 'Definir minha senha' }))
    expect(await screen.findByLabelText('Escolha a sua senha')).toBeInTheDocument()
  })

  it('falha desconhecida ao abrir o link', async () => {
    const { auth, user } = setup()
    vi.spyOn(auth, 'redeemActivationToken').mockRejectedValue(new Error('boom'))
    await user.click(screen.getByRole('button', { name: 'Definir minha senha' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível abrir o link')
  })

  it('senha curta é recusada antes de ir ao servidor', async () => {
    const { auth, onDone, user } = setup()
    const setPassword = vi.spyOn(auth, 'setPassword')
    await user.click(screen.getByRole('button', { name: 'Definir minha senha' }))
    await user.type(await screen.findByLabelText('Escolha a sua senha'), 'curta')
    await user.click(screen.getByRole('button', { name: 'Salvar senha e entrar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('pelo menos 10 caracteres')
    expect(setPassword).not.toHaveBeenCalled()
    expect(onDone).not.toHaveBeenCalled()
  })

  it.each([
    ['senha fraca', new AuthFailure('WEAK_PASSWORD', 'x'), /não é aceita/],
    ['sem internet', new AuthFailure('NETWORK', 'x'), /Sem conexão/],
    ['outra falha', new Error('boom'), /Não foi possível salvar/],
  ])('ao salvar: %s', async (_name, failure, message) => {
    const { auth, onDone, user } = setup()
    vi.spyOn(auth, 'setPassword').mockRejectedValue(failure)
    await user.click(screen.getByRole('button', { name: 'Definir minha senha' }))
    await user.type(await screen.findByLabelText('Escolha a sua senha'), PASSWORD)
    await user.click(screen.getByRole('button', { name: 'Salvar senha e entrar' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(onDone).not.toHaveBeenCalled()
    // O formulário continua para tentar de novo.
    expect(screen.getByLabelText('Escolha a sua senha')).toHaveValue(PASSWORD)
  })
})
