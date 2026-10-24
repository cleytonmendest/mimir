import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarketPicker, type PickableMarket } from './MarketPicker'

const MARKETS: PickableMarket[] = [
  {
    id: 'm-1',
    name: 'Loja 01 - Ipanema',
    address: 'Rua Visconde de Pirajá 118 - Ipanema',
    capacity: 5,
  },
  { id: 'm-2', name: 'Loja 07 - Leblon', address: 'Rua Dias Ferreira 290 - Leblon', capacity: 3 },
  { id: 'm-3', name: 'Loja 06 - Gávea', address: 'Av Rodrigo Otavio 269 - Gávea', capacity: 1 },
]

/** O navegador mede a tela com matchMedia; o jsdom não tem, então o teste diz se a tela é larga. */
function screenIs(width: 'wide' | 'narrow') {
  vi.stubGlobal('matchMedia', (query: string): Partial<MediaQueryList> => ({
    matches: width === 'wide',
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }))
}

function setup(selectedId: string | null = 'm-1') {
  const onSelect = vi.fn<(id: string) => void>()
  const view = render(
    <MarketPicker
      headingId="picker-title"
      hint="Escolha onde quer montar o estande."
      emptyMessage="Nenhum mercado está aceitando reservas por enquanto."
      markets={MARKETS}
      selectedId={selectedId}
      onSelect={onSelect}
      detail={(market) => <span>vagas de {market.name}</span>}
    />,
  )
  return { onSelect, user: userEvent.setup(), ...view }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MarketPicker: tela larga', () => {
  it('mostra todos os mercados com o limite, o escolhido marcado e os detalhes só nele', () => {
    screenIs('wide')
    setup()
    expect(screen.getByRole('button', { name: /Loja 01 - Ipanema/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: /Loja 07 - Leblon/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getAllByText('estandes/dia')).toHaveLength(2)
    expect(screen.getByText('estande/dia')).toBeInTheDocument()
    expect(screen.getByText('vagas de Loja 01 - Ipanema')).toBeInTheDocument()
    expect(screen.queryByText('vagas de Loja 07 - Leblon')).not.toBeInTheDocument()
  })

  it('não recolhe: escolher avisa e a lista continua inteira, sem "Trocar de mercado"', async () => {
    screenIs('wide')
    const { onSelect, user } = setup()
    expect(screen.queryByRole('button', { name: 'Trocar de mercado' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Loja 07 - Leblon/ }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('m-2')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('a busca sem resultado oferece mostrar todos os mercados de volta', async () => {
    screenIs('wide')
    const { user } = setup()
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(
      screen.getByText('Tente outro bairro ou nome, ou veja a lista inteira.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Mostrar todos os mercados' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('sem mercados, diz isso', () => {
    screenIs('wide')
    render(
      <MarketPicker
        headingId="vazio-title"
        hint="Escolha."
        emptyMessage="Nenhum mercado está aceitando reservas por enquanto."
        markets={[]}
        selectedId={null}
        onSelect={() => undefined}
      />,
    )
    expect(
      screen.getByText('Nenhum mercado está aceitando reservas por enquanto.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})

describe('MarketPicker: celular', () => {
  it('nasce aberta, com a busca, mesmo com um mercado já escolhido', () => {
    screenIs('narrow')
    setup()
    expect(screen.getByRole('searchbox', { name: 'Buscar por bairro ou nome' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(screen.getByRole('button', { name: 'Fechar a lista' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
  })

  it('escolher outro mercado avisa quem usa e recolhe a lista', async () => {
    screenIs('narrow')
    const { onSelect, user } = setup()
    await user.type(screen.getByRole('searchbox'), 'leblon')
    await user.click(screen.getByRole('button', { name: /Loja 07 - Leblon/ }))
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('m-2')
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })

  it('escolher o que já estava escolhido só recolhe, e o foco vai para "Trocar de mercado"', async () => {
    screenIs('narrow')
    const { user, onSelect } = setup()
    await user.click(screen.getByRole('button', { name: /Loja 01 - Ipanema/ }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Loja 07 - Leblon/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Loja 01 - Ipanema/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trocar de mercado' })).toHaveFocus()
    expect(screen.queryByText('Escolha onde quer montar o estande.')).not.toBeInTheDocument()
  })

  it('"Trocar de mercado" traz a lista inteira de volta, com a busca limpa e o foco nela', async () => {
    screenIs('narrow')
    const { user } = setup()
    await user.type(screen.getByRole('searchbox'), 'gavea')
    await user.click(screen.getByRole('button', { name: /Loja 06 - Gávea/ }))
    await user.click(screen.getByRole('button', { name: 'Trocar de mercado' }))

    const field = screen.getByRole('searchbox', { name: 'Buscar por bairro ou nome' })
    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('"Fechar a lista" recolhe sem escolher outro mercado', async () => {
    screenIs('narrow')
    const { user, onSelect } = setup()
    await user.click(screen.getByRole('button', { name: 'Fechar a lista' }))
    expect(onSelect).not.toHaveBeenCalled()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Trocar de mercado' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('sem mercado escolhido não há o que recolher: a lista fica aberta e sem o botão', () => {
    screenIs('narrow')
    setup(null)
    expect(screen.queryByRole('button', { name: 'Trocar de mercado' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Fechar a lista' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })
})
