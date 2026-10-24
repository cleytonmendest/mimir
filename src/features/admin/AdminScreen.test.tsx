import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeAccessGateway } from '@/features/access/testing'
import { createFakeBookingGateway, market, type FakeBooking } from '@/features/booking/testing'
import { AdminScreen } from './AdminScreen'

const TODAY = '2026-10-21'
const now = () => new Date('2026-10-21T15:00:00Z')

function setup(
  extra: {
    bookings?: FakeBooking[]
    closed?: { marketId: string; day: string; reason?: string }[]
  } = {},
) {
  const fake = createFakeBookingGateway({
    actor: { id: 'u-lia', role: 'admin' },
    today: TODAY,
    markets: [
      market('m-a', 'Mercado A', 3),
      market('m-b', 'Mercado B', 2),
      market('m-c', 'Antigo', 3, true),
    ],
    bookings: extra.bookings ?? [],
    closed: extra.closed ?? [],
    names: { 'u-bia': 'Biscoitos Dona Bia', 'u-caio': 'Café do Caio' },
  })
  const user = userEvent.setup()
  render(
    <AdminScreen gateway={fake.gateway} access={createFakeAccessGateway().gateway} now={now} />,
  )
  return { ...fake, user }
}

const day = (name: RegExp) => screen.findByRole('button', { name })
const panel = (title: string) =>
  screen.getByRole('heading', { name: title }).closest('section') as HTMLElement

afterEach(() => {
  cleanup()
})

const BOOKED: FakeBooking[] = [
  { id: 'b1', marketId: 'm-a', day: '2026-10-24', supplierId: 'u-bia' },
  { id: 'b2', marketId: 'm-a', day: '2026-10-24', supplierId: 'u-caio' },
]

describe('Agenda', () => {
  it('abre na agenda do primeiro mercado, com as próximas reservas e os nomes', async () => {
    setup({ bookings: BOOKED })
    expect(await screen.findByRole('heading', { name: 'Outubro de 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-pressed', 'true')
    const upcoming = panel('Próximas reservas')
    expect(within(upcoming).getByText('Biscoitos Dona Bia')).toBeInTheDocument()
    expect(within(upcoming).getByText('Café do Caio')).toBeInTheDocument()
    // O mercado arquivado não aparece na agenda.
    expect(screen.queryByRole('button', { name: /Antigo/ })).not.toBeInTheDocument()
  })

  it('escolher um dia mostra quem reservou, sem calendário de "sua reserva"', async () => {
    const { user } = setup({ bookings: BOOKED })
    await user.click(await day(/^Sábado, 24 de outubro: 1 vaga livre de 3$/))
    const dayPanel = panel('Sábado, 24 de outubro')
    expect(within(dayPanel).getByText('Biscoitos Dona Bia')).toBeInTheDocument()
    expect(within(dayPanel).getByText('Café do Caio')).toBeInTheDocument()
    expect(within(dayPanel).getByText('1 vaga livre de 3')).toBeInTheDocument()
  })

  it('um dia sem reservas diz isso', async () => {
    const { user } = setup()
    await user.click(await day(/^Sábado, 24 de outubro/))
    expect(screen.getByText('Nenhuma reserva neste dia.')).toBeInTheDocument()
    expect(screen.getByText('Ainda não há reservas.')).toBeInTheDocument()
  })

  it('fecha um dia com motivo, e as reservas feitas continuam', async () => {
    const { user, closed } = setup({ bookings: BOOKED })
    await user.click(await day(/^Sábado, 24 de outubro/))
    await user.type(screen.getByLabelText('Motivo, se for fechar (opcional)'), 'Inventário')
    await user.click(screen.getByRole('button', { name: 'Fechar este dia para novas reservas' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Dia fechado para novas reservas. 2 reservas já feitas continuam valendo.',
    )
    expect(closed).toContainEqual({ marketId: 'm-a', day: '2026-10-24', reason: 'Inventário' })
    const dayPanel = panel('Sábado, 24 de outubro')
    expect(await within(dayPanel).findByText('Fechado para novas reservas')).toBeInTheDocument()
    expect(within(dayPanel).getByText('Motivo: Inventário')).toBeInTheDocument()
    expect(within(dayPanel).getByText('Biscoitos Dona Bia')).toBeInTheDocument()
  })

  it('libera um dia fechado', async () => {
    const { user, closed } = setup({
      closed: [{ marketId: 'm-a', day: '2026-10-26', reason: 'Feriado' }],
    })
    await user.click(await day(/^Segunda-feira, 26 de outubro: fechado/))
    await user.click(screen.getByRole('button', { name: 'Liberar este dia' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Dia liberado para reservas.')
    expect(closed).toHaveLength(0)
  })

  it('cancela a reserva de um fornecedor, com motivo, depois de perguntar', async () => {
    const { user, bookings } = setup({ bookings: BOOKED })
    await user.click(await day(/^Sábado, 24 de outubro/))
    await user.click(screen.getByRole('button', { name: 'Cancelar a reserva de Café do Caio' }))
    const confirm = screen.getByRole('group', { name: 'Confirmar cancelamento' })
    expect(confirm).toHaveTextContent('O sistema não avisa o fornecedor: combine com ele.')
    await user.type(within(confirm).getByLabelText('Motivo (opcional)'), 'Faltou aviso')
    await user.click(within(confirm).getByRole('button', { name: 'Cancelar reserva' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Reserva cancelada.')
    expect(bookings.find((entry) => entry.id === 'b2')).toMatchObject({
      cancelled: true,
      cancelReason: 'Faltou aviso',
    })
    const dayPanel = panel('Sábado, 24 de outubro')
    expect(
      await within(dayPanel)
        .findByText('1 vaga livre de 3', {}, { timeout: 2000 })
        .catch(() => null),
    ).toBeDefined()
    expect(within(dayPanel).queryByText('Café do Caio')).not.toBeInTheDocument()
  })

  it('"Manter" desiste de cancelar', async () => {
    const { user, bookings } = setup({ bookings: BOOKED })
    await user.click(await day(/^Sábado, 24 de outubro/))
    await user.click(screen.getByRole('button', { name: 'Cancelar a reserva de Café do Caio' }))
    await user.click(screen.getByRole('button', { name: 'Manter' }))
    expect(screen.queryByRole('group', { name: 'Confirmar cancelamento' })).not.toBeInTheDocument()
    expect(bookings.every((entry) => entry.cancelled !== true)).toBe(true)
  })

  it('troca de mercado e mostra o calendário dele', async () => {
    const { user } = setup()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await user.click(screen.getByRole('button', { name: /^Mercado B/ }))
    expect(await day(/^Sábado, 24 de outubro: 2 vagas livres de 2/)).toBeInTheDocument()
  })

  it('sem sinal mostra o erro e "Tentar de novo" recupera', async () => {
    const fake = createFakeBookingGateway({
      actor: { id: 'u-lia', role: 'admin' },
      today: TODAY,
      markets: [market('m-a', 'Mercado A')],
    })
    fake.state.fail = 'NETWORK'
    const user = userEvent.setup()
    render(
      <AdminScreen gateway={fake.gateway} access={createFakeAccessGateway().gateway} now={now} />,
    )
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão')
    fake.state.fail = null
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('heading', { name: 'Outubro de 2026' })).toBeInTheDocument()
  })
})

describe('Mercados', () => {
  async function openMarkets() {
    const world = setup({
      bookings: [...BOOKED, { id: 'b3', marketId: 'm-a', day: '2026-10-24', supplierId: 'u-bia2' }],
    })
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await world.user.click(screen.getByRole('button', { name: 'Mercados' }))
    await screen.findByRole('heading', { name: 'Seus mercados' })
    return world
  }

  it('o formulário de novo mercado só reclama ao sair do campo e leva o foco ao erro no envio', async () => {
    const { user } = await openMarkets()
    const form = screen.getByRole('form', { name: 'Novo mercado' })
    const name = within(form).getByLabelText('Nome')
    await user.type(name, 'Loja Nova')
    await user.clear(name)
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()

    await user.tab()
    expect(within(form).getByRole('alert')).toHaveTextContent('Informe o nome do mercado.')
    await user.click(name)
    expect(within(form).queryByRole('alert')).not.toBeInTheDocument()

    await user.click(within(form).getByRole('button', { name: 'Cadastrar mercado' }))
    expect(within(form).getByRole('alert')).toHaveTextContent('Informe o nome do mercado.')
    expect(name).toHaveFocus()
  })

  it('guarda o que foi digitado: ao voltar à tela o formulário reaparece preenchido, e dá para descartar', async () => {
    const { user } = await openMarkets()
    await user.type(screen.getByLabelText('Nome'), 'Mercado Aurora')
    await user.type(screen.getByLabelText('Endereço (opcional)'), 'Av. 2')
    expect(screen.queryByText('Recuperamos o que você tinha digitado.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agenda' }))
    await user.click(screen.getByRole('button', { name: 'Mercados' }))
    expect(await screen.findByLabelText('Nome')).toHaveValue('Mercado Aurora')
    expect(screen.getByLabelText('Endereço (opcional)')).toHaveValue('Av. 2')
    expect(screen.getByText('Recuperamos o que você tinha digitado.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Descartar rascunho' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('')
    expect(screen.getByLabelText('Endereço (opcional)')).toHaveValue('')
    expect(screen.queryByText('Recuperamos o que você tinha digitado.')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Agenda' }))
    await user.click(screen.getByRole('button', { name: 'Mercados' }))
    expect(await screen.findByLabelText('Nome')).toHaveValue('')
    expect(screen.queryByText('Recuperamos o que você tinha digitado.')).not.toBeInTheDocument()
  })

  it('cadastrar o mercado apaga o rascunho', async () => {
    const { user } = await openMarkets()
    await user.type(screen.getByLabelText('Nome'), 'Mercado Aurora')
    await user.click(screen.getByRole('button', { name: 'Cadastrar mercado' }))
    await screen.findByText('Mercado Aurora', { selector: 'h3' })

    await user.click(screen.getByRole('button', { name: 'Agenda' }))
    await user.click(screen.getByRole('button', { name: 'Mercados' }))
    expect(await screen.findByLabelText('Nome')).toHaveValue('')
    expect(screen.queryByText('Recuperamos o que você tinha digitado.')).not.toBeInTheDocument()
  })

  it('lista os mercados, os arquivados marcados, cada um com o limite', async () => {
    await openMarkets()
    expect(
      screen.getByRole('group', { name: 'Limite de estandes por dia, Mercado A' }),
    ).toHaveTextContent('3')
    expect(screen.getByText('Arquivado: não aceita novas reservas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reativar Antigo' })).toBeInTheDocument()
  })

  it('cadastra um mercado novo, e o formulário volta ao início', async () => {
    const { user, markets } = await openMarkets()
    await user.type(screen.getByLabelText('Nome'), 'Mercado Aurora')
    await user.type(screen.getByLabelText('Endereço (opcional)'), 'Av. 2')
    await user.click(
      screen.getByRole('button', { name: 'Aumentar: Estandes por dia do novo mercado' }),
    )
    await user.click(screen.getByRole('button', { name: 'Cadastrar mercado' }))

    expect(await screen.findByText('Mercado Aurora', { selector: 'h3' })).toBeInTheDocument()
    expect(markets.find((entry) => entry.name === 'Mercado Aurora')).toMatchObject({
      address: 'Av. 2',
      capacity: 4,
    })
    expect(screen.getByLabelText('Nome')).toHaveValue('')
  })

  it('nome vazio mostra o motivo e não cadastra', async () => {
    const { user, markets } = await openMarkets()
    const before = markets.length
    await user.click(screen.getByRole('button', { name: 'Cadastrar mercado' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Informe o nome do mercado.')
    expect(markets).toHaveLength(before)
  })

  it('muda o limite com + e −, e avisa quando fica abaixo do que já está reservado', async () => {
    const { user, markets } = await openMarkets()
    const stepper = screen.getByRole('group', { name: 'Limite de estandes por dia, Mercado A' })

    await user.click(within(stepper).getByRole('button', { name: /^Aumentar/ }))
    expect(await screen.findByText('Limite de Mercado A: 4 estandes por dia.')).toBeInTheDocument()
    expect(markets.find((entry) => entry.id === 'm-a')?.capacity).toBe(4)

    await user.click(within(stepper).getByRole('button', { name: /^Diminuir/ }))
    await user.click(within(stepper).getByRole('button', { name: /^Diminuir/ }))
    expect(markets.find((entry) => entry.id === 'm-a')?.capacity).toBe(2)
    expect(
      await screen.findByText(/já tem 3 reservas: os dias que passam do limite novo continuam/),
    ).toBeInTheDocument()
  })

  it('edita nome e endereço', async () => {
    const { user, markets } = await openMarkets()
    await user.click(screen.getByRole('button', { name: 'Editar Mercado B' }))
    const form = screen.getByRole('form', { name: 'Editar Mercado B' })
    await user.clear(within(form).getByLabelText('Nome'))
    await user.type(within(form).getByLabelText('Nome'), 'Mercado Bairro Novo')
    await user.click(within(form).getByRole('button', { name: 'Salvar' }))
    expect(await screen.findByText('Mercado Bairro Novo', { selector: 'h3' })).toBeInTheDocument()
    expect(markets.some((entry) => entry.name === 'Mercado Bairro Novo')).toBe(true)
  })

  it('editar com nome vazio mostra o motivo, e "Cancelar" fecha o formulário', async () => {
    const { user } = await openMarkets()
    await user.click(screen.getByRole('button', { name: 'Editar Mercado B' }))
    const form = screen.getByRole('form', { name: 'Editar Mercado B' })
    await user.clear(within(form).getByLabelText('Nome'))
    await user.click(within(form).getByRole('button', { name: 'Salvar' }))
    expect(await within(form).findByRole('alert')).toHaveTextContent('Informe o nome do mercado.')
    await user.click(within(form).getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('form', { name: 'Editar Mercado B' })).not.toBeInTheDocument()
  })

  it('arquiva com confirmação e reativa', async () => {
    const { user, markets } = await openMarkets()
    await user.click(screen.getByRole('button', { name: 'Arquivar Mercado B' }))
    const confirm = screen.getByRole('group', { name: 'Confirmar arquivamento' })
    expect(confirm).toHaveTextContent('Arquivar Mercado B?')
    expect(within(confirm).getByRole('button', { name: 'Manter' })).toHaveFocus()
    await user.click(within(confirm).getByRole('button', { name: 'Manter' }))
    expect(screen.queryByRole('group', { name: 'Confirmar arquivamento' })).not.toBeInTheDocument()
    // O botão que abriu a confirmação recebe o foco de volta.
    expect(screen.getByRole('button', { name: 'Arquivar Mercado B' })).toHaveFocus()

    await user.click(screen.getByRole('button', { name: 'Arquivar Mercado B' }))
    await user.click(screen.getByRole('button', { name: 'Sim, arquivar' }))
    expect(await screen.findByText(/Mercado B arquivado\./)).toBeInTheDocument()
    expect(markets.find((entry) => entry.id === 'm-b')?.archived).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Reativar Mercado B' }))
    expect(markets.find((entry) => entry.id === 'm-b')?.archived).toBe(false)
  })

  it('sem sinal ao abrir mostra o erro e "Tentar de novo" recupera', async () => {
    const { user, state } = setup()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    state.fail = 'NETWORK'
    await user.click(screen.getByRole('button', { name: 'Mercados' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão')
    state.fail = null
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('heading', { name: 'Seus mercados' })).toBeInTheDocument()
  })

  it('sem nenhum mercado, avisa', async () => {
    const fake = createFakeBookingGateway({
      actor: { id: 'u-lia', role: 'admin' },
      today: TODAY,
      markets: [],
    })
    const user = userEvent.setup()
    render(
      <AdminScreen gateway={fake.gateway} access={createFakeAccessGateway().gateway} now={now} />,
    )
    expect(
      await screen.findByText('Nenhum mercado ativo. Cadastre um na aba Mercados.'),
    ).toBeInTheDocument()
    expect(screen.getByText('Escolha um mercado para ver os dias.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Mercados' }))
    expect(await screen.findByText('Nenhum mercado cadastrado ainda.')).toBeInTheDocument()
  })
})

describe('Buscar mercado', () => {
  const lojas = [
    { ...market('m-1', 'Loja 01 - Ipanema', 3), address: 'Rua Visconde de Pirajá 118 - Ipanema' },
    { ...market('m-2', 'Loja 06 - Gávea', 2), address: 'Av Rodrigo Otavio 269 - Gávea' },
    { ...market('m-3', 'Loja 07 - Leblon', 4), address: 'Rua Dias Ferreira 290 - Leblon' },
  ]

  function setupLojas() {
    const fake = createFakeBookingGateway({
      actor: { id: 'u-lia', role: 'admin' },
      today: TODAY,
      markets: lojas,
      bookings: [],
      closed: [],
    })
    const user = userEvent.setup()
    render(
      <AdminScreen gateway={fake.gateway} access={createFakeAccessGateway().gateway} now={now} />,
    )
    return { ...fake, user }
  }

  it('na agenda, filtra a lista de mercados pelo bairro', async () => {
    const { user } = setupLojas()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await user.type(screen.getByRole('searchbox', { name: 'Buscar por bairro ou nome' }), 'gavea')
    expect(screen.getByRole('button', { name: /Loja 06 - Gávea/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Loja 07 - Leblon/ })).not.toBeInTheDocument()
    expect(screen.getByText('1 de 3 mercados')).toBeInTheDocument()
  })

  it('em Mercados, filtra as linhas e o formulário de cadastro segue no lugar', async () => {
    const { user } = setupLojas()
    await screen.findByRole('heading', { name: 'Outubro de 2026' })
    await user.click(screen.getByRole('button', { name: 'Mercados' }))
    await screen.findByRole('heading', { name: 'Seus mercados' })

    await user.type(screen.getByRole('searchbox', { name: 'Buscar por bairro ou nome' }), 'ipanema')
    expect(screen.getByRole('heading', { name: 'Loja 01 - Ipanema' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Loja 07 - Leblon' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cadastrar mercado' })).toBeInTheDocument()

    await user.type(screen.getByRole('searchbox'), ' zzz')
    expect(screen.getByText('Nenhum mercado encontrado.')).toBeInTheDocument()
  })
})
