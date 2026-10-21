import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { AccountBar } from './AccountBar'
import { AuthGate } from './AuthGate'
import { AuthProvider } from './AuthProvider'
import { ana, createFakeGateway, createFakeIdentityStore, lia, type FakeSetup } from './testing'

const ACCOUNTS = { 'ana@test.dev': ana, 'lia@test.dev': lia }
const SAVED_AT = '2026-10-21T10:00:00.000Z'
const anaIdentity = { profile: ana.profile!, savedAt: SAVED_AT }

function deferred() {
  let release: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

function setup(
  config: FakeSetup = {},
  identity: ReturnType<typeof createFakeIdentityStore> = createFakeIdentityStore(),
  unsentCount?: () => Promise<number>,
) {
  const gateway = createFakeGateway({ accounts: ACCOUNTS, ...config })
  render(
    <AuthProvider gateway={gateway} device={identity} sessionTimeoutMs={30} profileTimeoutMs={30}>
      <AuthGate>
        {(profile, { offline }) => (
          <>
            <AccountBar profile={profile} {...(unsentCount ? { unsentCount } : {})} />
            {offline && <p>modo sem conexão</p>}
          </>
        )}
      </AuthGate>
    </AuthProvider>,
  )
  return { gateway, identity, user: userEvent.setup() }
}

describe('abrir o app sem falar com o servidor', () => {
  it('o SDK demora (token vencido, sem rede): abre com a identidade guardada', async () => {
    const hold = deferred()
    setup(
      { signedInAs: 'ana@test.dev', holdSession: hold.promise },
      createFakeIdentityStore(anaIdentity),
    )

    expect(await screen.findByText('Ana · Repositor')).toBeInTheDocument()
    expect(screen.getByText('modo sem conexão')).toBeInTheDocument()
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument()
  })

  it('quando o SDK enfim responde e o perfil chega, volta ao modo normal e renova a identidade', async () => {
    const hold = deferred()
    const { identity } = setup(
      { signedInAs: 'ana@test.dev', holdSession: hold.promise },
      createFakeIdentityStore(anaIdentity),
    )
    await screen.findByText('modo sem conexão')

    hold.release()

    await screen.findByText('Ana · Repositor')
    await waitFor(() => expect(screen.queryByText('modo sem conexão')).not.toBeInTheDocument())
    expect(identity.calls.saved).toBe(1)
  })

  it('quando o SDK enfim responde que ninguém está logado, volta ao formulário e esquece a identidade', async () => {
    const hold = deferred()
    const { identity } = setup({ holdSession: hold.promise }, createFakeIdentityStore(anaIdentity))
    await screen.findByText('modo sem conexão')

    hold.release()

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(identity.current()).toBeNull()
  })

  it('sem identidade guardada, esperar o SDK não abre nada: continua carregando', async () => {
    const hold = deferred()
    setup({ signedInAs: 'ana@test.dev', holdSession: hold.promise })

    await new Promise((resolve) => setTimeout(resolve, 80))

    expect(screen.getByRole('status')).toHaveTextContent('Carregando')
    hold.release()
    expect(await screen.findByText('Ana · Repositor')).toBeInTheDocument()
  })

  it('a sessão existe mas o perfil não chega (sem rede): abre com a identidade do mesmo usuário', async () => {
    const gateway = createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })
    gateway.setFault('offline')
    render(
      <AuthProvider gateway={gateway} device={createFakeIdentityStore(anaIdentity)}>
        <AuthGate>
          {(profile, { offline }) => (
            <>
              <AccountBar profile={profile} />
              {offline && <p>modo sem conexão</p>}
            </>
          )}
        </AuthGate>
      </AuthProvider>,
    )

    expect(await screen.findByText('Ana · Repositor')).toBeInTheDocument()
    expect(screen.getByText('modo sem conexão')).toBeInTheDocument()
  })

  it('o perfil não chega e a identidade guardada é de OUTRO usuário: não abre com a dos outros', async () => {
    const gateway = createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'lia@test.dev' })
    gateway.setFault('offline')
    render(
      <AuthProvider
        gateway={gateway}
        device={createFakeIdentityStore(anaIdentity)}
        sessionTimeoutMs={30}
        profileTimeoutMs={30}
      >
        <AuthGate>{(profile) => <AccountBar profile={profile} />}</AuthGate>
      </AuthProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar')
    expect(screen.queryByText('Ana · Repositor')).not.toBeInTheDocument()
  })

  it('a leitura da sessão falha (sem rede) com identidade guardada: abre; sem ela: avisa', async () => {
    const withIdentity = createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })
    withIdentity.setFault('session')
    const { unmount } = render(
      <AuthProvider gateway={withIdentity} device={createFakeIdentityStore(anaIdentity)}>
        <AuthGate>{(profile) => <AccountBar profile={profile} />}</AuthGate>
      </AuthProvider>,
    )
    expect(await screen.findByText('Ana · Repositor')).toBeInTheDocument()
    unmount()

    const without = createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })
    without.setFault('session')
    render(
      <AuthProvider gateway={without} device={createFakeIdentityStore()}>
        <AuthGate>{(profile) => <AccountBar profile={profile} />}</AuthGate>
      </AuthProvider>,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conectar')
  })

  it('erro de configuração nunca abre com a identidade guardada: mostra o que falta', async () => {
    const gateway = createFakeGateway({ accounts: ACCOUNTS })
    gateway.setFault('config')
    render(
      <AuthProvider gateway={gateway} device={createFakeIdentityStore(anaIdentity)}>
        <AuthGate>{(profile) => <AccountBar profile={profile} />}</AuthGate>
      </AuthProvider>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Defina VITE_SUPABASE_URL')
  })

  it('armazenamento do aparelho com defeito não impede o app de abrir online', async () => {
    const broken = {
      identity: () => Promise.reject(new Error('banco fechado')),
      saveIdentity: () => Promise.reject(new Error('banco fechado')),
      clearIdentity: () => Promise.reject(new Error('banco fechado')),
    }
    const gateway = createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })
    render(
      <AuthProvider gateway={gateway} device={broken}>
        <AuthGate>{(profile) => <AccountBar profile={profile} />}</AuthGate>
      </AuthProvider>,
    )

    expect(await screen.findByText('Ana · Repositor')).toBeInTheDocument()
  })
})

describe('de volta ao servidor', () => {
  it('em modo sem conexão, um novo aviso do SDK (token renovado) confirma o perfil', async () => {
    const hold = deferred()
    const { gateway } = setup(
      { signedInAs: 'ana@test.dev', holdSession: hold.promise },
      createFakeIdentityStore(anaIdentity),
    )
    await screen.findByText('modo sem conexão')

    gateway.emitAgain()

    await waitFor(() => expect(screen.queryByText('modo sem conexão')).not.toBeInTheDocument())
    expect(screen.getByText('Ana · Repositor')).toBeInTheDocument()
  })

  it('se a sessão for revogada por fora, o app deixa de abrir como esse usuário', async () => {
    const hold = deferred()
    const { gateway, identity } = setup(
      { signedInAs: 'ana@test.dev', holdSession: hold.promise },
      createFakeIdentityStore(anaIdentity),
    )
    await screen.findByText('modo sem conexão')

    gateway.expireSession()

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(identity.current()).toBeNull()
  })
})

describe('identidade guardada', () => {
  it('guarda a identidade ao entrar online e apaga ao sair', async () => {
    const { identity, user } = setup()
    await screen.findByLabelText('E-mail')

    await user.type(screen.getByLabelText('E-mail'), 'ana@test.dev')
    await user.type(screen.getByLabelText('Senha'), 'segredo-da-ana')
    await user.click(screen.getByRole('button', { name: 'Entrar' }))
    await screen.findByText('Ana · Repositor')
    await waitFor(() => expect(identity.current()?.profile).toEqual(ana.profile))

    await user.click(screen.getByRole('button', { name: 'Sair' }))

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(identity.current()).toBeNull()
  })

  it('se sair falhar, a identidade continua guardada', async () => {
    const identity = createFakeIdentityStore(anaIdentity)
    const gateway = createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })
    gateway.signOut = () => Promise.reject(new Error('sem armazenamento'))
    render(
      <AuthProvider gateway={gateway} device={identity}>
        <AuthGate>{(profile) => <AccountBar profile={profile} />}</AuthGate>
      </AuthProvider>,
    )
    await screen.findByText('Ana · Repositor')

    await userEvent.setup().click(screen.getByRole('button', { name: 'Sair' }))

    await screen.findByRole('alert')
    expect(identity.current()).not.toBeNull()
  })
})

describe('sair com trabalho não enviado', () => {
  it('sem pendência, sai direto', async () => {
    const { user } = setup({ signedInAs: 'ana@test.dev' }, createFakeIdentityStore(), () =>
      Promise.resolve(0),
    )
    await screen.findByText('Ana · Repositor')

    await user.click(screen.getByRole('button', { name: 'Sair' }))

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
  })

  it('com pendência, avisa quantos e só sai se a pessoa confirmar', async () => {
    const { user } = setup({ signedInAs: 'ana@test.dev' }, createFakeIdentityStore(), () =>
      Promise.resolve(3),
    )
    await screen.findByText('Ana · Repositor')

    await user.click(screen.getByRole('button', { name: 'Sair' }))

    const warning = await screen.findByRole('group', { name: 'Confirmar saída' })
    expect(warning).toHaveTextContent('3 registros')
    expect(screen.getByText('Ana · Repositor')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Sair mesmo assim' }))
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
  })

  it('um registro só fala no singular, e "Continuar no app" desiste de sair', async () => {
    const { user } = setup({ signedInAs: 'ana@test.dev' }, createFakeIdentityStore(), () =>
      Promise.resolve(1),
    )
    await screen.findByText('Ana · Repositor')
    await user.click(screen.getByRole('button', { name: 'Sair' }))
    expect(await screen.findByRole('group', { name: 'Confirmar saída' })).toHaveTextContent(
      'Há 1 registro neste aparelho',
    )

    await user.click(screen.getByRole('button', { name: 'Continuar no app' }))

    expect(screen.queryByRole('group', { name: 'Confirmar saída' })).not.toBeInTheDocument()
    expect(screen.getByText('Ana · Repositor')).toBeInTheDocument()
  })

  it('se contar falhar, sai (sair não apaga nada do aparelho)', async () => {
    const { user } = setup({ signedInAs: 'ana@test.dev' }, createFakeIdentityStore(), () =>
      Promise.reject(new Error('banco fechado')),
    )
    await screen.findByText('Ana · Repositor')

    await user.click(screen.getByRole('button', { name: 'Sair' }))

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
  })
})
