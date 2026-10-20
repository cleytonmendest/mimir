import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'
import { ana, createFakeGateway } from './features/auth/testing'

describe('App', () => {
  it('abre e mostra o título, mesmo antes de saber quem está logado', () => {
    render(<App gateway={createFakeGateway()} />)
    expect(screen.getByRole('heading', { name: 'Rota do repositor' })).toBeInTheDocument()
  })

  it('sem sessão pede o login; com sessão mostra o app', async () => {
    const { unmount } = render(
      <App gateway={createFakeGateway({ accounts: { 'ana@test.dev': ana } })} />,
    )
    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    unmount()

    render(
      <App
        gateway={createFakeGateway({
          accounts: { 'ana@test.dev': ana },
          signedInAs: 'ana@test.dev',
        })}
      />,
    )
    expect(await screen.findByText('Ana · Repositor')).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Status de uma visita' })).toBeInTheDocument()
  })
})
