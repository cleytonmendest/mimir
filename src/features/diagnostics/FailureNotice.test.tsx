import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FailureNotice } from './FailureNotice'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function setup(props: { details?: string | null } = {}) {
  const onRetry = vi.fn()
  const user = userEvent.setup()
  render(
    <FailureNotice
      message="Sem conexão com o servidor. Confira a internet e tente de novo."
      details={props.details === undefined ? 'RequestFailure NETWORK: fetch failed' : props.details}
      onRetry={onRetry}
    >
      <button type="button">Sair</button>
    </FailureNotice>,
  )
  return { onRetry, user }
}

describe('FailureNotice', () => {
  it('mostra o aviso, deixa tentar de novo e mantém as outras saídas', async () => {
    const { onRetry, user } = setup()
    expect(screen.getByRole('alert')).toHaveTextContent('Sem conexão com o servidor.')
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument()
  })

  it('"Copiar detalhes do erro" copia quando, onde, versão e o erro, e confirma', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Copiar detalhes do erro' }))
    expect(await screen.findByText('Detalhes copiados.')).toBeInTheDocument()

    const copied = await navigator.clipboard.readText()
    expect(copied).toContain('Detalhes do erro - Agenda de Degustações')
    expect(copied).toMatch(/Quando: \d{4}-\d{2}-\d{2}T/)
    expect(copied).toContain(`Tela: ${window.location.pathname}`)
    expect(copied).toContain(`Versão: ${__APP_VERSION__}`)
    expect(copied).toContain('O que a tela disse: Sem conexão com o servidor.')
    expect(copied).toContain('RequestFailure NETWORK: fetch failed')
  })

  it('o endereço copiado não leva a query nem o hash (links de acesso têm token)', async () => {
    window.history.replaceState(null, '', '/definir-senha?token=segredo#outro')
    try {
      const { user } = setup()
      await user.click(screen.getByRole('button', { name: 'Copiar detalhes do erro' }))
      await screen.findByText('Detalhes copiados.')
      const copied = await navigator.clipboard.readText()
      expect(copied).toContain('Tela: /definir-senha')
      expect(copied).not.toContain('segredo')
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  it('sem lado técnico, ainda copia o resto', async () => {
    const { user } = setup({ details: null })
    await user.click(screen.getByRole('button', { name: 'Copiar detalhes do erro' }))
    await screen.findByText('Detalhes copiados.')
    expect(await navigator.clipboard.readText()).not.toContain('RequestFailure')
  })

  it('sem permissão para copiar, mostra o texto para selecionar à mão', async () => {
    const { user } = setup()
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('negado'))
    await user.click(screen.getByRole('button', { name: 'Copiar detalhes do erro' }))
    expect(
      await screen.findByText('Não deu para copiar. Selecione o texto abaixo e copie.'),
    ).toBeInTheDocument()
    const manual = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Detalhes do erro' })
    expect(manual.value).toContain('RequestFailure NETWORK: fetch failed')
  })
})
