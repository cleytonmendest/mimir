import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MarketCard } from './MarketCard'

describe('MarketCard', () => {
  it('o nome é o botão, e diz se está escolhido', () => {
    render(
      <MarketCard name="Mercado Central" subtitle="Centro" selected onSelect={() => undefined} />,
    )
    const button = screen.getByRole('button', { name: /Mercado Central/ })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveTextContent('Centro')
  })

  it('escolher avisa quem usa', async () => {
    const onSelect = vi.fn()
    render(<MarketCard name="Mercado Jardim" selected={false} onSelect={onSelect} />)
    await userEvent.click(screen.getByRole('button', { name: /Mercado Jardim/ }))
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('o rodapé fica fora do botão', () => {
    render(
      <MarketCard name="Mercado Jardim" selected={false} onSelect={() => undefined}>
        <span>3 estandes por dia</span>
      </MarketCard>,
    )
    expect(screen.getByRole('button', { name: /Mercado Jardim/ })).not.toHaveTextContent('estandes')
    expect(screen.getByText('3 estandes por dia')).toBeInTheDocument()
  })

  it('o selo mostra um dado curto, sem entrar no nome do botão', () => {
    render(
      <MarketCard
        name="Mercado Jardim"
        selected={false}
        onSelect={() => undefined}
        badge={<span>3 por dia</span>}
      />,
    )
    expect(screen.getByText('3 por dia')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mercado Jardim' })).toBeInTheDocument()
  })

  it('sem subtítulo nem rodapé', () => {
    render(<MarketCard name="Mercado Vila Nova" selected={false} onSelect={() => undefined} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
  })
})
