import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ChevronLeft } from 'lucide-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IconButton } from './IconButton'

afterEach(cleanup)

describe('IconButton', () => {
  it('tem nome acessível, é um botão que não envia formulário e avisa o clique', async () => {
    const onClick = vi.fn()
    render(
      <IconButton label="Mês anterior" onClick={onClick}>
        <ChevronLeft />
      </IconButton>,
    )
    const button = screen.getByRole('button', { name: 'Mês anterior' })
    expect(button).toHaveAttribute('type', 'button')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('mostra o tooltip quando o teclado chega no botão, e esconde ao sair', async () => {
    const user = userEvent.setup()
    render(
      <IconButton label="Mês anterior">
        <ChevronLeft />
      </IconButton>,
    )
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    await user.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Mês anterior')
    await user.tab()
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('mostra o tooltip com o mouse em cima', async () => {
    const user = userEvent.setup()
    render(
      <IconButton label="Próximo mês">
        <ChevronLeft />
      </IconButton>,
    )
    await user.hover(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Próximo mês')
  })

  it('o tooltip pode ser mais curto que o nome acessível', async () => {
    const user = userEvent.setup()
    render(
      <IconButton label="Aumentar: Limite de estandes por dia, Loja 07" tooltip="Aumentar">
        <ChevronLeft />
      </IconButton>,
    )
    await user.tab()
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/^Aumentar$/)
    expect(
      screen.getByRole('button', { name: 'Aumentar: Limite de estandes por dia, Loja 07' }),
    ).toBeInTheDocument()
  })

  it('desligado, não é clicável', () => {
    render(
      <IconButton label="Mês anterior" disabled>
        <ChevronLeft />
      </IconButton>,
    )
    expect(screen.getByRole('button', { name: 'Mês anterior' })).toBeDisabled()
  })
})
