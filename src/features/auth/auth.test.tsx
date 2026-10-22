import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AccountBar } from './AccountBar'
import { AuthGate } from './AuthGate'
import { AuthProvider } from './AuthProvider'
import { useAuth } from './auth-context'
import { ana, createFakeGateway, lia, type FakeSetup } from './testing'

const ACCOUNTS = { 'ana@test.dev': ana, 'lia@test.dev': lia }

function setup(config: FakeSetup = {}) {
  const gateway = createFakeGateway({ accounts: ACCOUNTS, ...config })
  render(
    <AuthProvider gateway={gateway}>
      <AuthGate>{(profile) => <AccountBar profile={profile} />}</AuthGate>
    </AuthProvider>,
  )
  return { gateway, user: userEvent.setup() }
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  email: string,
  password: string,
) {
  await user.type(screen.getByLabelText('E-mail'), email)
  await user.type(screen.getByLabelText('Senha'), password)
  await user.click(screen.getByRole('button', { name: 'Entrar' }))
}

describe('login', () => {
  it('sem sessão no aparelho mostra o formulário (e nenhum "criar conta")', async () => {
    setup()

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.getByLabelText('Senha')).toHaveAttribute('type', 'password')
    expect(screen.queryByText(/criar conta|cadastr/i)).not.toBeInTheDocument()
  })

  it('quem já tem sessão no aparelho entra direto, sem digitar nada', async () => {
    setup({ signedInAs: 'ana@test.dev' })

    expect(await screen.findByText('Ana · Fornecedor')).toBeInTheDocument()
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument()
  })

  it('entra com e-mail e senha certos, ignorando espaços no e-mail, e mostra nome e papel', async () => {
    const { user } = setup()
    await screen.findByLabelText('E-mail')

    await fillAndSubmit(user, '  lia@test.dev ', 'segredo-da-lia')

    expect(await screen.findByText('Lia · Administrador')).toBeInTheDocument()
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument()
  })

  it('senha errada avisa e continua no formulário, com os campos preservados', async () => {
    const { user } = setup()
    await screen.findByLabelText('E-mail')

    await fillAndSubmit(user, 'ana@test.dev', 'errada')

    expect(await screen.findByRole('alert')).toHaveTextContent('E-mail ou senha incorretos.')
    expect(screen.getByLabelText('E-mail')).toHaveValue('ana@test.dev')
    expect(screen.getByRole('button', { name: 'Entrar' })).toBeEnabled()
  })

  it('sem internet na hora de entrar avisa da conexão', async () => {
    const { gateway, user } = setup()
    await screen.findByLabelText('E-mail')
    gateway.setFault('offline')

    await fillAndSubmit(user, 'ana@test.dev', 'segredo-da-ana')

    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão com o servidor')
  })

  it('o aviso de erro some quando a pessoa tenta de novo', async () => {
    const { user } = setup()
    await screen.findByLabelText('E-mail')
    await fillAndSubmit(user, 'ana@test.dev', 'errada')
    await screen.findByRole('alert')

    await user.clear(screen.getByLabelText('Senha'))
    await user.type(screen.getByLabelText('Senha'), 'segredo-da-ana')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))

    expect(await screen.findByText('Ana · Fornecedor')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('enquanto envia, o botão fica desabilitado e diz "Entrando…" (evita envio duplo)', async () => {
    let release: () => void = () => undefined
    const holdSignIn = new Promise<void>((resolve) => {
      release = resolve
    })
    const { user } = setup({ holdSignIn })
    await screen.findByLabelText('E-mail')

    await fillAndSubmit(user, 'ana@test.dev', 'segredo-da-ana')

    expect(screen.getByRole('button', { name: 'Entrando…' })).toBeDisabled()

    release()
    expect(await screen.findByText('Ana · Fornecedor')).toBeInTheDocument()
  })

  it('e-mail e senha são obrigatórios', async () => {
    setup()
    await screen.findByLabelText('E-mail')

    expect(screen.getByLabelText('E-mail')).toBeRequired()
    expect(screen.getByLabelText('Senha')).toBeRequired()
  })
})

describe('versão do app', () => {
  it('a barra da conta mostra a versão (é o que o suporte pergunta)', async () => {
    setup({ signedInAs: 'ana@test.dev' })

    expect(await screen.findByText(`Versão ${__APP_VERSION__}`)).toBeInTheDocument()
    expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+\+\w+$/)
  })
})

describe('sair', () => {
  it('"Sair" devolve ao formulário', async () => {
    const { user } = setup({ signedInAs: 'ana@test.dev' })
    await screen.findByText('Ana · Fornecedor')

    await user.click(screen.getByRole('button', { name: 'Sair' }))

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.queryByText('Ana · Fornecedor')).not.toBeInTheDocument()
  })

  it('se sair falhar, avisa em vez de fingir que saiu', async () => {
    const gateway = createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })
    gateway.signOut = () => Promise.reject(new Error('sem armazenamento'))
    render(
      <AuthProvider gateway={gateway}>
        <AuthGate>{(profile) => <AccountBar profile={profile} />}</AuthGate>
      </AuthProvider>,
    )
    await screen.findByText('Ana · Fornecedor')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sair' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar')
  })
})

describe('falhas ao abrir o app', () => {
  it('sem configuração do servidor mostra o que falta, e "Tentar de novo" recupera', async () => {
    const gateway = createFakeGateway({ accounts: ACCOUNTS })
    gateway.setFault('config')
    render(
      <AuthProvider gateway={gateway}>
        <AuthGate>{(profile) => <AccountBar profile={profile} />}</AuthGate>
      </AuthProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Defina VITE_SUPABASE_URL')

    gateway.setFault(null)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
  })

  it('sessão guardada mas sem internet para buscar o perfil: avisa e "Tentar de novo" recupera', async () => {
    const gateway = createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })
    gateway.setFault('offline')
    render(
      <AuthProvider gateway={gateway}>
        <AuthGate>{(profile) => <AccountBar profile={profile} />}</AuthGate>
      </AuthProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Verifique a internet')

    gateway.setFault(null)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByText('Ana · Fornecedor')).toBeInTheDocument()
  })

  it('usuário sem perfil: avisa para falar com o administrador e permite sair', async () => {
    const semPerfil = { userId: 'u-x', password: 'x', profile: null }
    const { user } = setup({
      accounts: { 'x@test.dev': semPerfil },
      signedInAs: 'x@test.dev',
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Fale com o administrador')

    await user.click(screen.getByRole('button', { name: 'Sair' }))
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
  })

  it('perfil sem nome cadastrado não deixa a barra vazia', async () => {
    const semNome = {
      userId: 'u-y',
      password: 'y',
      profile: { id: 'u-y', role: 'supplier' as const, fullName: '  ', active: true },
    }
    setup({ accounts: { 'y@test.dev': semNome }, signedInAs: 'y@test.dev' })

    expect(await screen.findByText('Sem nome cadastrado · Fornecedor')).toBeInTheDocument()
  })
})

describe('troca de usuário e avisos repetidos', () => {
  it('um segundo aviso do mesmo usuário (renovação de token) não recarrega o perfil', async () => {
    const gateway = createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })
    const loadProfile = vi.spyOn(gateway, 'loadProfile')
    render(
      <AuthProvider gateway={gateway}>
        <AuthGate>{(profile) => <AccountBar profile={profile} />}</AuthGate>
      </AuthProvider>,
    )
    await screen.findByText('Ana · Fornecedor')

    // O SDK repete o aviso a cada renovação do token: aqui, simulado por um login do mesmo usuário.
    await gateway.signIn('ana@test.dev', 'segredo-da-ana')
    await Promise.resolve()

    expect(loadProfile).toHaveBeenCalledTimes(1)
  })
})

describe('useAuth', () => {
  it('fora do <AuthProvider> falha com uma mensagem clara', () => {
    function Orphan() {
      useAuth()
      return null
    }
    const silence = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(<Orphan />)).toThrow('useAuth só funciona dentro de <AuthProvider>')

    silence.mockRestore()
  })
})

describe('conta desativada', () => {
  it('entra, mas só vê o aviso e a saída, nunca a área do fornecedor', async () => {
    const desativada = {
      userId: 'u-d',
      password: 'd',
      profile: { id: 'u-d', role: 'supplier' as const, fullName: 'Dora', active: false },
    }
    const user = userEvent.setup()
    render(
      <AuthProvider
        gateway={createFakeGateway({
          accounts: { 'd@test.dev': desativada },
          signedInAs: 'd@test.dev',
        })}
      >
        <AuthGate>{() => <p>ÁREA DO FORNECEDOR</p>}</AuthGate>
      </AuthProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Sua conta foi desativada')
    expect(screen.queryByText('ÁREA DO FORNECEDOR')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sair' }))
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
  })
})
