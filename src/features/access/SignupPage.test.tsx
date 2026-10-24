import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeGateway, type FakeAccount } from '@/features/auth/testing'
import { SignupPage } from './SignupPage'
import { createFakeAccessGateway, supplier } from './testing'

const PASSWORD = 'uma-senha-bem-longa'
const nova: FakeAccount = {
  userId: 'u-nova',
  password: PASSWORD,
  profile: { id: 'u-nova', role: 'supplier', fullName: 'Loja Nova', active: true },
}

function setup(
  settings: { mode: 'closed' | 'invite' | 'open'; inviteCode: string | null },
  code = '',
) {
  const fake = createFakeAccessGateway({ settings, suppliers: [supplier('u-ana', 'Ana')] })
  const auth = createFakeGateway({ accounts: { 'nova@loja.com': nova } })
  const onDone = vi.fn()
  const user = userEvent.setup()
  render(<SignupPage access={fake.gateway} auth={auth} code={code} onDone={onDone} />)
  return { ...fake, auth, onDone, user }
}

async function fillIn(
  user: ReturnType<typeof userEvent.setup>,
  values: { name?: string; email?: string; password?: string; code?: string },
) {
  if (values.code !== undefined) {
    const field = await screen.findByLabelText('Código de convite')
    await user.clear(field)
    await user.type(field, values.code)
  }
  await user.type(await screen.findByLabelText('Nome ou empresa'), values.name ?? 'Loja Nova')
  await user.type(screen.getByLabelText('E-mail'), values.email ?? 'nova@loja.com')
  await user.type(screen.getByLabelText('Escolha uma senha'), values.password ?? PASSWORD)
}

const submit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: 'Criar conta' }))

afterEach(() => {
  cleanup()
})

describe('cadastro fechado', () => {
  it('só avisa, sem formulário', async () => {
    setup({ mode: 'closed', inviteCode: null })
    expect(await screen.findByText(/O cadastro está fechado/)).toBeInTheDocument()
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entre aqui' })).toHaveAttribute('href', '/')
  })
})

describe('cadastro com código', () => {
  const settings = { mode: 'invite' as const, inviteCode: 'K7QD4MX2' }

  it('abre com o código do link já preenchido', async () => {
    setup(settings, 'K7QD4MX2')
    expect(await screen.findByLabelText('Código de convite')).toHaveValue('K7QD-4MX2')
  })

  it('cria a conta, entra e segue para o app', async () => {
    const { state, auth, onDone, user } = setup(settings, 'K7QD4MX2')
    const signIn = vi.spyOn(auth, 'signIn')
    await fillIn(user, {})
    await submit(user)

    await vi.waitFor(() => {
      expect(onDone).toHaveBeenCalledTimes(1)
    })
    expect(state.signUps).toEqual([
      {
        email: 'nova@loja.com',
        fullName: 'Loja Nova',
        password: PASSWORD,
        code: 'K7QD-4MX2',
      },
    ])
    expect(signIn).toHaveBeenCalledWith('nova@loja.com', PASSWORD)
  })

  it('o e-mail é guardado em minúsculas e sem espaços', async () => {
    const { state, user } = setup(settings, 'K7QD4MX2')
    await fillIn(user, { email: '  Nova@Loja.COM ' })
    await submit(user)
    await vi.waitFor(() => {
      expect(state.signUps[0]?.email).toBe('nova@loja.com')
    })
  })

  it('código errado: explica e mantém o que foi digitado', async () => {
    const { onDone, user } = setup(settings)
    await fillIn(user, { code: 'AAAA-AAAA' })
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Esse código não vale')
    expect(onDone).not.toHaveBeenCalled()
    expect(screen.getByLabelText('E-mail')).toHaveValue('nova@loja.com')
  })

  it('sem código, nem tenta', async () => {
    const { state, user } = setup(settings)
    await fillIn(user, {})
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe o código de convite')
    expect(state.signUps).toHaveLength(0)
  })

  it('e-mail que já tem conta', async () => {
    const { user } = setup(settings, 'K7QD4MX2')
    await fillIn(user, { email: 'u-ana@loja.com' })
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe uma conta com esse e-mail',
    )
  })

  it('conta criada mas a entrada falha: diz que a conta existe', async () => {
    const { auth, onDone, user } = setup(settings, 'K7QD4MX2')
    vi.spyOn(auth, 'signIn').mockRejectedValue(new Error('x'))
    await fillIn(user, {})
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Conta criada!')
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('cadastro livre', () => {
  const settings = { mode: 'open' as const, inviteCode: null }

  it('sem campo de código; pede para confirmar o e-mail', async () => {
    const { state, onDone, user } = setup(settings)
    expect(await screen.findByLabelText('Nome ou empresa')).toBeInTheDocument()
    expect(screen.queryByLabelText('Código de convite')).not.toBeInTheDocument()
    await fillIn(user, {})
    await submit(user)

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Enviamos uma mensagem para nova@loja.com',
    )
    expect(state.signUps[0]).not.toHaveProperty('code')
    expect(onDone).not.toHaveBeenCalled()
  })
})

describe('conferências e erros', () => {
  const settings = { mode: 'open' as const, inviteCode: null }

  it.each([
    ['sem nome', { name: ' ', email: 'nova@loja.com' }, 'Informe o nome do fornecedor.'],
    ['com e-mail torto', { name: 'Loja Nova', email: 'torto' }, 'Esse e-mail não parece certo'],
  ])('%s: não vai ao servidor', async (_name, values, message) => {
    const { state, user } = setup(settings)
    const user2 = user
    await user2.type(await screen.findByLabelText('Nome ou empresa'), values.name)
    await user2.type(screen.getByLabelText('E-mail'), values.email)
    await user2.type(screen.getByLabelText('Escolha uma senha'), PASSWORD)
    await submit(user2)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(state.signUps).toHaveLength(0)
  })

  it('senha curta: o aviso diz o mínimo', async () => {
    const { state, user } = setup(settings)
    await fillIn(user, { password: 'curta' })
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('pelo menos 10 caracteres')
    expect(state.signUps).toHaveLength(0)
  })

  it.each([
    ['RATE_LIMITED', 'Muitas tentativas'],
    ['WEAK_PASSWORD', 'fraca demais'],
    ['INVALID_INPUT', 'Confira os dados'],
    ['UNRECOGNIZED', 'Não foi possível criar a conta agora'],
  ] as const)('recusa %s', async (outcome, message) => {
    const { state, user } = setup(settings)
    state.signUpOutcome = outcome
    await fillIn(user, {})
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
  })

  it('o administrador fechou o cadastro enquanto a pessoa preenchia', async () => {
    const { state, user } = setup(settings)
    state.signUpOutcome = 'SIGNUP_CLOSED'
    await fillIn(user, {})
    await submit(user)
    expect(await screen.findByText(/O cadastro está fechado/)).toBeInTheDocument()
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument()
  })

  it('sem internet ao enviar', async () => {
    const { state, user } = setup(settings)
    await fillIn(user, {})
    state.fail = 'NETWORK'
    await submit(user)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão')
  })
})

describe('carregar a página', () => {
  it('sem internet, dá para tentar de novo', async () => {
    const fake = createFakeAccessGateway({ settings: { mode: 'open', inviteCode: null } })
    fake.state.fail = 'NETWORK'
    const user = userEvent.setup()
    render(
      <SignupPage
        access={fake.gateway}
        auth={createFakeGateway()}
        code=""
        onDone={() => undefined}
      />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão')
    fake.state.fail = null
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByLabelText('Nome ou empresa')).toBeInTheDocument()
  })
})

describe('cadastro: validação ao sair do campo', () => {
  it('cada campo reclama ao sair, nunca enquanto se digita', async () => {
    const { user } = setup({ mode: 'open', inviteCode: null })
    const name = await screen.findByLabelText('Nome ou empresa')
    await user.type(screen.getByLabelText('E-mail'), 'nova@')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(name)
    await user.tab()
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'Informe o nome do fornecedor.',
    ])
    await user.tab()
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toContain(
      'Esse e-mail não parece certo. Confira e tente de novo.',
    )
  })

  it('enviar vazio, no modo com código, mostra todos os erros e foca o código', async () => {
    const { user } = setup({ mode: 'invite', inviteCode: 'K7QD4MXA' })
    await screen.findByLabelText('Código de convite')
    const create = screen.getByRole('button', { name: 'Criar conta' })
    expect(create).toBeEnabled()

    await submit(user)
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'Informe o código de convite.',
      'Informe o nome do fornecedor.',
      'Informe o e-mail.',
      'A senha precisa ter pelo menos 10 caracteres.',
    ])
    expect(screen.getByLabelText('Código de convite')).toHaveFocus()
  })

  it('no modo livre não pede código', async () => {
    const { user } = setup({ mode: 'open', inviteCode: null })
    await screen.findByLabelText('Nome ou empresa')
    await submit(user)
    expect(screen.queryByLabelText('Código de convite')).not.toBeInTheDocument()
    expect(screen.getAllByRole('alert')).toHaveLength(3)
    expect(screen.getByLabelText('Nome ou empresa')).toHaveFocus()
  })
})
