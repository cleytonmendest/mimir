import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { ana, createFakeGateway, lia } from './features/auth/testing'

const ACCOUNTS = { 'ana@test.dev': ana, 'lia@test.dev': lia }

describe('App', () => {
  it('abre e mostra o título, mesmo antes de saber quem está logado', () => {
    render(<App auth={createFakeGateway()} />)
    expect(screen.getByRole('heading', { name: 'Agenda de Degustações' })).toBeInTheDocument()
  })

  it('sem sessão pede o login e não mostra nenhuma área', async () => {
    render(<App auth={createFakeGateway({ accounts: ACCOUNTS })} />)

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reservas' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mercados' })).not.toBeInTheDocument()
  })

  it('o fornecedor logado cai na área de reservas, não na de administração', async () => {
    render(<App auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })} />)

    expect(await screen.findByRole('heading', { name: 'Reservas' })).toBeInTheDocument()
    expect(screen.getByText('Ana · Fornecedor')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mercados' })).not.toBeInTheDocument()
  })

  it('o administrador logado cai na área de mercados, não na de reservas', async () => {
    render(<App auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'lia@test.dev' })} />)

    expect(await screen.findByRole('heading', { name: 'Mercados' })).toBeInTheDocument()
    expect(screen.getByText('Lia · Administrador')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reservas' })).not.toBeInTheDocument()
  })
})
