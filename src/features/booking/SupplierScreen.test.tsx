import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { RequestFailure } from '@/lib/supabase/errors'
import { SupplierScreen } from './SupplierScreen'
import { createFakeBookingGateway, market, type FakeBooking } from './testing'

const TODAY = '2026-10-21'
const now = () => new Date('2026-10-21T15:00:00Z')

function setup(
  extra: { bookings?: FakeBooking[]; closed?: { marketId: string; day: string }[] } = {},
) {
  const fake = createFakeBookingGateway({
    actor: { id: 'u-ana', role: 'supplier' },
    today: TODAY,
    markets: [market('m-a', 'Mercado A', 3), market('m-b', 'Mercado B', 2)],
    bookings: extra.bookings ?? [],
    closed: extra.closed ?? [],
  })
  const user = userEvent.setup()
  render(<SupplierScreen gateway={fake.gateway} now={now} />)
  return { ...fake, user }
}

const day = (name: RegExp) => screen.findByRole('button', { name })

afterEach(() => {
  cleanup()
})

describe('SupplierScreen: abrir', () => {
  it('mostra os mercados com o limite, o calendário do primeiro e que ainda não há reservas', async () => {
    setup()
    expect(await screen.findByRole('heading', { name: 'Outubro de 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mercado A/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getAllByText('estandes/dia', { exact: false })).toHaveLength(2)
    expect(screen.getByText('Você ainda não tem reservas.')).toBeInTheDocument()
    expect(
      screen.getByText('Escolha um mercado e um dia abaixo para fazer a primeira.'),
    ).toBeInTheDocument()
    expect(
      screen.getByText('Escolha um dia no calendário. Dias verdes e amarelos têm vaga.'),
    ).toBeInTheDocument()
  })

  it('o mercado escolhido mostra as vagas livres dos próximos 7 dias', async () => {
    setup({ bookings: [{ id: 'b1', marketId: 'm-a', day: '2026-10-22', supplierId: 'u-bia' }] })
    expect(
      await screen.findByText('vagas livres nos próximos 7 dias', { exact: false }),
    ).toHaveTextContent('20')
  })

  it('sem sinal: mostra o erro e "Tentar de novo" recupera', async () => {
    const { state, user } = setup()
    state.fail = 'NETWORK'
    // O primeiro start já correu: força um novo carregamento falho.
    cleanup()
    const fake = createFakeBookingGateway({
      actor: { id: 'u-ana', role: 'supplier' },
      today: TODAY,
      markets: [market('m-a', 'Mercado A')],
    })
    fake.state.fail = 'NETWORK'
    render(<SupplierScreen gateway={fake.gateway} now={now} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão')
    fake.state.fail = null
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('heading', { name: 'Outubro de 2026' })).toBeInTheDocument()
  })

  it('o calendário que falha oferece tentar de novo, sem derrubar a tela', async () => {
    const fake = createFakeBookingGateway({
      actor: { id: 'u-ana', role: 'supplier' },
      today: TODAY,
      markets: [market('m-a', 'Mercado A')],
    })
    let broken = true
    const user = userEvent.setup()
    render(
      <SupplierScreen
        now={now}
        gateway={{
          ...fake.gateway,
          availability: (...args) =>
            broken
              ? Promise.reject(new RequestFailure('NETWORK', 'sem rede'))
              : fake.gateway.availability(...args),
        }}
      />,
    )
    expect(await screen.findByText(/Sem conexão com o servidor/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mercado A/ })).toBeInTheDocument()
    broken = false
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('heading', { name: 'Outubro de 2026' })).toBeInTheDocument()
  })

  it('sem nenhum mercado aberto, avisa', async () => {
    const fake = createFakeBookingGateway({
      actor: { id: 'u-ana', role: 'supplier' },
      today: TODAY,
      markets: [market('m-c', 'Antigo', 3, true)],
    })
    render(<SupplierScreen gateway={fake.gateway} now={now} />)
    expect(
      await screen.findByText('Nenhum mercado está aceitando reservas por enquanto.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Escolha um mercado para ver os dias.')).toBeInTheDocument()
  })
})

describe('SupplierScreen: reservar', () => {
  it('escolhe o dia, confirma e a reserva aparece em todo lugar', async () => {
    const { user, bookings } = setup()
    await user.click(await day(/^Sábado, 24 de outubro: 3 vagas livres de 3/))

    expect(screen.getByRole('heading', { name: 'Sábado, 24 de outubro' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reservar este dia' }))
    const confirm = screen.getByRole('group', { name: 'Confirmar reserva' })
    expect(confirm).toHaveTextContent('Reservar um estande em Mercado A no dia 24/10?')
    await user.click(within(confirm).getByRole('button', { name: 'Confirmar reserva' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Reserva confirmada: Mercado A, sábado, 24 de outubro.',
    )
    expect(bookings).toHaveLength(1)
    // O calendário, o painel e "Minhas reservas" mostram a reserva.
    expect(
      await day(/^Sábado, 24 de outubro: 2 vagas livres de 3. Sua reserva/),
    ).toBeInTheDocument()
    expect(screen.getByText('Você tem uma reserva neste dia.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'sáb 24/10 Mercado A: ver no calendário' }),
    ).toBeInTheDocument()
  })

  it('"Voltar" desiste da confirmação', async () => {
    const { user, bookings } = setup()
    await user.click(await day(/^Sábado, 24 de outubro/))
    await user.click(screen.getByRole('button', { name: 'Reservar este dia' }))
    await user.click(screen.getByRole('button', { name: 'Voltar' }))
    expect(screen.getByRole('button', { name: 'Reservar este dia' })).toBeInTheDocument()
    expect(bookings).toHaveLength(0)
  })

  it('A ÚLTIMA VAGA: outro fornecedor ocupa enquanto a pessoa confirma, e ela é avisada', async () => {
    const { user, state, occupy, bookings } = setup({
      bookings: [
        { id: 'b1', marketId: 'm-a', day: '2026-10-24', supplierId: 'u-bia' },
        { id: 'b2', marketId: 'm-a', day: '2026-10-24', supplierId: 'u-caio' },
      ],
    })
    await user.click(await day(/^Sábado, 24 de outubro: 1 vaga livre de 3/))
    await user.click(screen.getByRole('button', { name: 'Reservar este dia' }))
    state.beforeBook = () => {
      occupy('m-a', '2026-10-24', 'u-dora')
    }

    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'a última vaga deste dia acabou de ser ocupada por outro fornecedor',
    )
    // A tela aprende o que o servidor decidiu: o dia está lotado e o botão não oferece mais reservar.
    expect(await day(/^Sábado, 24 de outubro: lotado/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reservar este dia' })).toBeDisabled()
    expect(bookings.some((entry) => entry.supplierId === 'u-ana')).toBe(false)
  })

  it('dia lotado não deixa reservar', async () => {
    const { user } = setup({
      bookings: ['u-bia', 'u-caio', 'u-dora'].map((supplierId, index) => ({
        id: `b${index}`,
        marketId: 'm-a',
        day: '2026-10-24',
        supplierId,
      })),
    })
    await user.click(await day(/^Sábado, 24 de outubro: lotado/))
    expect(
      screen.getByText(/Lotado\. Os 3 estandes deste dia já estão reservados/),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reservar este dia' })).toBeDisabled()
  })

  it('dia fechado explica e não deixa reservar', async () => {
    const { user } = setup({ closed: [{ marketId: 'm-a', day: '2026-10-26' }] })
    await user.click(await day(/^Segunda-feira, 26 de outubro: fechado/))
    expect(
      screen.getByText('Este dia está fechado para reservas neste mercado.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reservar este dia' })).not.toBeInTheDocument()
    const panel = screen
      .getByRole('heading', { name: 'Segunda-feira, 26 de outubro' })
      .closest('section') as HTMLElement
    expect(within(panel).getByText('Fechado')).toBeInTheDocument()
  })

  it('falha de rede na hora de reservar avisa e a tela segue usável', async () => {
    const { user, state } = setup()
    await user.click(await day(/^Sábado, 24 de outubro/))
    await user.click(screen.getByRole('button', { name: 'Reservar este dia' }))
    state.fail = 'NETWORK'
    await user.click(screen.getByRole('button', { name: 'Confirmar reserva' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão com o servidor')
    expect(screen.getByRole('button', { name: 'Reservar este dia' })).toBeEnabled()
    // O aviso de erro fica até a pessoa fechar.
    await user.click(screen.getByRole('button', { name: 'Fechar' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('SupplierScreen: cancelar', () => {
  const own: FakeBooking = { id: 'b-own', marketId: 'm-a', day: '2026-10-24', supplierId: 'u-ana' }

  it('cancela pela lista, com confirmação, e a vaga volta', async () => {
    const { user, bookings } = setup({ bookings: [own] })
    const mine = (await screen.findByText('Minhas reservas')).closest('section') as HTMLElement
    await user.click(within(mine).getByRole('button', { name: 'Cancelar reserva' }))
    const confirm = within(mine).getByRole('group', { name: 'Confirmar cancelamento' })
    await user.click(within(confirm).getByRole('button', { name: 'Sim, cancelar' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Reserva cancelada. A vaga voltou a ficar livre.',
    )
    expect(bookings[0]?.cancelled).toBe(true)
    expect(await screen.findByText('Você ainda não tem reservas.')).toBeInTheDocument()
    expect(await day(/^Sábado, 24 de outubro: 3 vagas livres de 3$/)).toBeInTheDocument()
  })

  it('a confirmação diz qual reserva vai embora, leva o foco a "Manter" e Esc devolve o foco ao botão', async () => {
    const { user } = setup({ bookings: [own] })
    const mine = await screen.findByRole('region', { name: 'Minhas reservas' })
    within(mine).getByRole('button', { name: 'Cancelar reserva' }).focus()
    await user.keyboard('{Enter}')

    const confirm = within(mine).getByRole('group', { name: 'Confirmar cancelamento' })
    expect(confirm).toHaveTextContent('Cancelar a reserva de sáb 24/10 em Mercado A?')
    expect(within(confirm).getByRole('button', { name: 'Manter' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(within(mine).queryByRole('group')).not.toBeInTheDocument()
    expect(within(mine).getByRole('button', { name: 'Cancelar reserva' })).toHaveFocus()
  })

  it('cancela pelo painel do dia, e "Manter" desiste', async () => {
    const { user, bookings } = setup({ bookings: [own] })
    await user.click(await day(/^Sábado, 24 de outubro.*Sua reserva/))
    const panel = screen
      .getByRole('heading', { name: 'Sábado, 24 de outubro' })
      .closest('section') as HTMLElement

    await user.click(within(panel).getByRole('button', { name: 'Cancelar reserva' }))
    await user.click(within(panel).getByRole('button', { name: 'Manter' }))
    expect(within(panel).getByRole('button', { name: 'Cancelar reserva' })).toBeInTheDocument()
    expect(bookings[0]?.cancelled).not.toBe(true)

    await user.click(within(panel).getByRole('button', { name: 'Cancelar reserva' }))
    await user.click(within(panel).getByRole('button', { name: 'Sim, cancelar' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Reserva cancelada')
  })

  it('"Ver no calendário" leva ao mercado e ao dia da reserva', async () => {
    const { user } = setup({
      bookings: [{ id: 'b-b', marketId: 'm-b', day: '2026-11-03', supplierId: 'u-ana' }],
    })
    await user.click(
      await screen.findByRole('button', { name: 'ter 03/11 Mercado B: ver no calendário' }),
    )
    expect(await screen.findByRole('heading', { name: 'Novembro de 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Mercado B/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('heading', { name: 'Terça-feira, 3 de novembro' })).toBeInTheDocument()
  })
})

describe('SupplierScreen: escolher e atualizar', () => {
  it('trocar de mercado mostra o calendário e o limite dele', async () => {
    const { user } = setup()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await user.click(screen.getByRole('button', { name: /^Mercado B/ }))
    expect(await day(/^Sábado, 24 de outubro: 2 vagas livres de 2/)).toBeInTheDocument()
  })

  it('navega para o mês seguinte', async () => {
    const { user } = setup()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await user.click(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(screen.getByRole('heading', { name: 'Novembro de 2026' })).toBeInTheDocument()
  })

  it('ao voltar para a aba, mostra o que mudou enquanto estava fechada', async () => {
    const { occupy } = setup()
    await day(/^Sábado, 24 de outubro: 3 vagas livres de 3/)
    occupy('m-a', '2026-10-24', 'u-bia')
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
      await Promise.resolve()
    })
    expect(await day(/^Sábado, 24 de outubro: 2 vagas livres de 3/)).toBeInTheDocument()
  })
})

describe('SupplierScreen: buscar mercado', () => {
  const lojas = [
    { ...market('m-1', 'Loja 01 - Ipanema', 3), address: 'Rua Visconde de Pirajá 118 - Ipanema' },
    { ...market('m-2', 'Loja 06 - Gávea', 2), address: 'Av Rodrigo Otavio 269 - Gávea' },
    { ...market('m-3', 'Loja 07 - Leblon', 4), address: 'Rua Dias Ferreira 290 - Leblon' },
    { ...market('m-4', 'Loja 22 - São Conrado', 3), address: 'Estrada da Gávea 870 - São Conrado' },
  ]

  function setupLojas(markets = lojas) {
    const fake = createFakeBookingGateway({
      actor: { id: 'u-ana', role: 'supplier' },
      today: TODAY,
      markets,
      bookings: [],
      closed: [],
    })
    const user = userEvent.setup()
    render(<SupplierScreen gateway={fake.gateway} now={now} />)
    return { ...fake, user }
  }

  it('filtra pelo bairro sem ligar para acento nem maiúscula, e diz quantos sobraram', async () => {
    const { user } = setupLojas()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await user.type(screen.getByRole('searchbox', { name: 'Buscar por bairro ou nome' }), 'GAVEA')

    // A Gávea pelo nome e a São Conrado, que só tem "Gávea" na rua.
    expect(screen.getByRole('button', { name: /Loja 06 - Gávea/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Loja 22 - São Conrado/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Loja 07 - Leblon/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Loja 01 - Ipanema/ })).not.toBeInTheDocument()
    expect(screen.getByText('2 de 4 mercados')).toBeInTheDocument()
  })

  it('sem resultado diz isso, e o "x" limpa a busca e traz todos de volta', async () => {
    const { user } = setupLojas()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await user.type(screen.getByRole('searchbox'), 'zzz')
    expect(screen.getByText('Nenhum mercado encontrado.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Loja 07/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(screen.getAllByRole('button', { name: /^Loja \d\d - / })).toHaveLength(4)
    expect(screen.queryByText('Nenhum mercado encontrado.')).not.toBeInTheDocument()
  })

  it('o mercado escolhido continua escolhido (e com o calendário) mesmo fora do filtro', async () => {
    const { user } = setupLojas()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    expect(screen.getByRole('button', { name: /Loja 01 - Ipanema/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.type(screen.getByRole('searchbox'), 'leblon')
    expect(screen.queryByRole('button', { name: /Loja 01 - Ipanema/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Outubro de 2026' })).toBeInTheDocument()
    expect(
      screen.getByText('Loja 01 - Ipanema', { exact: false, selector: 'p' }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Loja 07 - Leblon/ }))
    expect(screen.getByRole('button', { name: /Loja 07 - Leblon/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('com um mercado só, não há o que buscar', async () => {
    setupLojas([lojas[0]!])
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument()
  })
})

describe('SupplierScreen: minhas reservas no topo', () => {
  const own = (days: string[]): FakeBooking[] =>
    days.map((day, index) => ({
      id: `b${index}`,
      marketId: 'm-a',
      day,
      supplierId: 'u-ana',
    }))

  it('mostra as três primeiras e "Ver todas" abre o resto (e "Mostrar menos" fecha)', async () => {
    const { user } = setup({
      bookings: own(['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-26']),
    })
    const mine = await screen.findByRole('region', { name: 'Minhas reservas' })
    expect(within(mine).getAllByRole('listitem')).toHaveLength(3)

    const all = within(mine).getByRole('button', { name: 'Ver todas (4)' })
    expect(all).toHaveAttribute('aria-expanded', 'false')
    await user.click(all)
    expect(within(mine).getAllByRole('listitem')).toHaveLength(4)

    await user.click(within(mine).getByRole('button', { name: 'Mostrar menos' }))
    expect(within(mine).getAllByRole('listitem')).toHaveLength(3)
  })

  it('com até três reservas não há "Ver todas"', async () => {
    setup({ bookings: own(['2026-10-22', '2026-10-23', '2026-10-24']) })
    const mine = await screen.findByRole('region', { name: 'Minhas reservas' })
    expect(within(mine).getAllByRole('listitem')).toHaveLength(3)
    expect(within(mine).queryByRole('button', { name: /Ver todas/ })).not.toBeInTheDocument()
  })

  it('vem antes da lista de mercados na página', async () => {
    setup({ bookings: own(['2026-10-22']) })
    const mine = await screen.findByRole('region', { name: 'Minhas reservas' })
    const markets = screen.getByRole('region', { name: 'Mercados' })
    expect(mine.compareDocumentPosition(markets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
