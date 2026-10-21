import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
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

describe('App', () => {
  it('abre e mostra o título, mesmo antes de saber quem está logado', () => {
    render(<App auth={createFakeGateway()} booking={booking()} now={now} />)
    expect(screen.getByRole('heading', { name: 'Agenda de Degustações' })).toBeInTheDocument()
  })

  it('sem sessão pede o login e não mostra nenhuma área', async () => {
    render(<App auth={createFakeGateway({ accounts: ACCOUNTS })} booking={booking()} now={now} />)

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Reservas$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Administração' })).not.toBeInTheDocument()
  })

  it('o fornecedor logado cai na área de reservas, com os mercados e o calendário', async () => {
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })}
        booking={booking()}
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
        now={now}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Administração' })).toBeInTheDocument()
    expect(screen.getByText('Lia · Administrador')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mercados' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^Reservas$/ })).not.toBeInTheDocument()
  })
})
