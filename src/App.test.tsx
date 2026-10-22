import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { createFakeAccessGateway } from './features/access/testing'
import { ana, createFakeGateway, lia } from './features/auth/testing'
import { createFakeBookingGateway, market } from './features/booking/testing'

const ACCOUNTS = { 'ana@test.dev': ana, 'lia@test.dev': lia }
const now = () => new Date('2026-10-21T15:00:00Z')

function booking() {
  return createFakeBookingGateway({
    actor: { id: 'u-ana', role: 'supplier' },
    today: '2026-10-21',
    markets: [market('m-a', 'Mercado A')],
  }).gateway
}

const access = () => createFakeAccessGateway().gateway

describe('App', () => {
  it('abre e mostra o título, mesmo antes de saber quem está logado', () => {
    render(<App auth={createFakeGateway()} booking={booking()} access={access()} now={now} />)
    expect(screen.getByRole('heading', { name: 'Agenda de Degustações' })).toBeInTheDocument()
  })

  it('sem sessão pede o login e não mostra nenhuma área', async () => {
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS })}
        booking={booking()}
        access={access()}
        now={now}
      />,
    )

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Reservas$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Administração' })).not.toBeInTheDocument()
  })

  it('o fornecedor logado cai na área de reservas, com os mercados e o calendário', async () => {
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })}
        booking={booking()}
        access={access()}
        now={now}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Reservas' })).toBeInTheDocument()
    expect(screen.getByText('Ana · Fornecedor')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Outubro de 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mercado A/ })).toBeInTheDocument()
  })

  it('o administrador logado cai na área de mercados, não na de reservas', async () => {
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'lia@test.dev' })}
        booking={booking()}
        access={access()}
        now={now}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Administração' })).toBeInTheDocument()
    expect(screen.getByText('Lia · Administrador')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mercados' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Reservas$/ })).not.toBeInTheDocument()
  })
})

describe('páginas públicas', () => {
  const at = (pathname: string, search = '') => ({
    pathname,
    search,
    origin: 'https://agenda.exemplo',
  })

  it('/definir-senha mostra a ativação, sem pedir login', () => {
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS })}
        booking={booking()}
        access={access()}
        location={at('/definir-senha', '?token=abc')}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Defina a sua senha' })).toBeInTheDocument()
    expect(screen.queryByLabelText('E-mail')).not.toBeInTheDocument()
  })

  it('/cadastro mostra o cadastro, com o código do convite', async () => {
    const fake = createFakeAccessGateway({ settings: { mode: 'invite', inviteCode: 'K7QD4MXA' } })
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS })}
        booking={booking()}
        access={fake.gateway}
        location={at('/cadastro', '?codigo=K7QD-4MXA')}
      />,
    )
    expect(await screen.findByLabelText('Código de convite')).toHaveValue('K7QD-4MXA')
  })

  it('administrador vê as quatro áreas', async () => {
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'lia@test.dev' })}
        booking={booking()}
        access={access()}
        now={now}
        location={at('/', '')}
      />,
    )
    await screen.findByRole('heading', { name: 'Administração' })
    for (const name of ['Agenda', 'Mercados', 'Fornecedores', 'Configurações']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })
})
