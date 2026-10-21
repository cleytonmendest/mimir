import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Toast } from './Toast'

describe('Toast', () => {
  it('sucesso e informação são "status"', () => {
    render(
      <Toast kind="success" onClose={() => undefined}>
        Reserva confirmada.
      </Toast>,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Reserva confirmada.')
  })

  it('erro é "alert", lido na hora', () => {
    render(
      <Toast kind="error" onClose={() => undefined}>
        Não deu.
      </Toast>,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Não deu.')
  })

  it('"Fechar" avisa quem usa', async () => {
    const onClose = vi.fn()
    render(
      <Toast kind="info" onClose={onClose}>
        Oi
      </Toast>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
