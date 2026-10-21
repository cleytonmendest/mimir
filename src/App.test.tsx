import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { makeVisit } from '@/domain/testing'
import App from './App'
import { ana, createFakeGateway, lia } from './features/auth/testing'
import { createFakeVisitsGateway, market } from './features/today/testing'

const ACCOUNTS = { 'ana@test.dev': ana, 'lia@test.dev': lia }
const clock = () => ({ now: '2026-10-21T14:00:00.000Z', today: '2026-10-21' })
const visits = () =>
  createFakeVisitsGateway({
    markets: [market('market-a', 'Mercado A')],
    visits: [
      makeVisit({ id: 'v-a', repositorId: 'u-ana', marketId: 'market-a', date: '2026-10-21' }),
    ],
  }).gateway

describe('App', () => {
  it('abre e mostra o título, mesmo antes de saber quem está logado', () => {
    render(<App auth={createFakeGateway()} visits={visits()} clock={clock} />)
    expect(screen.getByRole('heading', { name: 'Rota do repositor' })).toBeInTheDocument()
  })

  it('sem sessão pede o login e não mostra visitas', async () => {
    render(<App auth={createFakeGateway({ accounts: ACCOUNTS })} visits={visits()} clock={clock} />)

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Hoje' })).not.toBeInTheDocument()
  })

  it('repositor logado vê a tela Hoje com as visitas dele', async () => {
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })}
        visits={visits()}
        clock={clock}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Hoje' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Mercado A' })).toBeInTheDocument()
  })

  it('líder logado não cai na tela de visitas do repositor', async () => {
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'lia@test.dev' })}
        visits={visits()}
        clock={clock}
      />,
    )

    expect(await screen.findByText('Lia · Líder')).toBeInTheDocument()
    expect(screen.getByText(/A visão do líder/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Hoje' })).not.toBeInTheDocument()
  })
})
