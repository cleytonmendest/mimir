import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeAccessGateway, supplier } from '@/features/access/testing'
import { createFakeBookingGateway, market } from '@/features/booking/testing'
import { AdminScreen } from './AdminScreen'

const ORIGIN = 'https://agenda.exemplo'

function setup(
  options: {
    settings?: { mode: 'closed' | 'invite' | 'open'; inviteCode: string | null }
    tab?: 'Fornecedores' | 'Configurações'
  } = {},
) {
  const access = createFakeAccessGateway({
    suppliers: [
      supplier('u-ana', 'Ana Doces'),
      supplier('u-bia', 'Biscoitos Bia'),
      supplier('u-zed', 'Zé', false),
    ],
    futureBookings: { 'u-bia': 2 },
    ...(options.settings === undefined ? {} : { settings: options.settings }),
  })
  const booking = createFakeBookingGateway({
    actor: { id: 'u-lia', role: 'admin' },
    today: '2026-10-21',
    markets: [market('m-a', 'Mercado A')],
  })
  const user = userEvent.setup()
  render(
    <AdminScreen
      gateway={booking.gateway}
      access={access.gateway}
      origin={ORIGIN}
      now={() => new Date('2026-10-21T15:00:00Z')}
    />,
  )
  return { ...access, user }
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole('button', { name }))
}

const row = (name: string) =>
  screen.getByRole('heading', { name, level: 3 }).closest('li') as HTMLElement

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('aba Fornecedores', () => {
  it('lista os fornecedores, com os desativados no fim e marcados', async () => {
    const { user } = setup()
    await openTab(user, 'Fornecedores')
    const items = await screen.findAllByRole('heading', { level: 3 })
    expect(items.map((item) => item.textContent)).toEqual(['Ana Doces', 'Biscoitos Bia', 'Zé'])
    expect(within(row('Zé')).getByText(/Desativado/)).toBeInTheDocument()
    expect(within(row('Ana Doces')).getByText('u-ana@loja.com')).toBeInTheDocument()
  })

  it('cadastra um fornecedor e entrega o link de ativação', async () => {
    const { user } = setup()
    await openTab(user, 'Fornecedores')
    await user.type(await screen.findByLabelText('Nome ou empresa'), 'Café do Caio')
    await user.type(screen.getByLabelText('E-mail'), 'caio@loja.com')
    await user.click(screen.getByRole('button', { name: 'Cadastrar fornecedor' }))

    const panel = await screen.findByRole('region', { name: 'Link de acesso' })
    expect(within(panel).getByLabelText<HTMLInputElement>('Link').value).toMatch(
      /^https:\/\/agenda\.exemplo\/definir-senha\?token=/,
    )
    expect(within(panel).getByRole('link', { name: 'Enviar pelo WhatsApp' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^https:\/\/wa\.me\/\?text=.*Caf.*definir-senha/),
    )
    expect(screen.getByRole('heading', { name: 'Café do Caio', level: 3 })).toBeInTheDocument()
    // O formulário volta vazio para o próximo.
    expect(screen.getByLabelText('Nome ou empresa')).toHaveValue('')

    await user.click(within(panel).getByRole('button', { name: 'Copiar link' }))
    expect(await within(panel).findByText('Link copiado.')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toMatch(/definir-senha\?token=/)

    await user.click(screen.getByRole('button', { name: 'Fechar o link' }))
    expect(screen.queryByRole('region', { name: 'Link de acesso' })).not.toBeInTheDocument()
  })

  it('guarda o nome e o e-mail digitados e os devolve ao voltar; cadastrar apaga o rascunho', async () => {
    const { user } = setup()
    await openTab(user, 'Fornecedores')
    await user.type(await screen.findByLabelText('Nome ou empresa'), 'Café do Caio')
    await user.type(screen.getByLabelText('E-mail'), 'caio@loja.com')

    await openTab(user, 'Configurações')
    await openTab(user, 'Fornecedores')
    expect(await screen.findByLabelText('Nome ou empresa')).toHaveValue('Café do Caio')
    expect(screen.getByLabelText('E-mail')).toHaveValue('caio@loja.com')
    expect(screen.getByText('Recuperamos o que você tinha digitado.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cadastrar fornecedor' }))
    await screen.findByRole('region', { name: 'Link de acesso' })
    await openTab(user, 'Configurações')
    await openTab(user, 'Fornecedores')
    expect(await screen.findByLabelText('Nome ou empresa')).toHaveValue('')
    expect(screen.queryByText('Recuperamos o que você tinha digitado.')).not.toBeInTheDocument()
  })

  it('dados inválidos e e-mail repetido mostram o erro no formulário', async () => {
    const { user } = setup()
    await openTab(user, 'Fornecedores')
    await user.click(await screen.findByRole('button', { name: 'Cadastrar fornecedor' }))
    // O envio mostra o erro de cada campo e leva o foco ao primeiro.
    expect((await screen.findAllByRole('alert')).map((alert) => alert.textContent)).toEqual([
      'Informe o nome do fornecedor.',
      'Informe o e-mail.',
    ])
    expect(screen.getByLabelText('Nome ou empresa')).toHaveFocus()

    await user.type(screen.getByLabelText('Nome ou empresa'), 'Outra Ana')
    await user.type(screen.getByLabelText('E-mail'), 'u-ana@loja.com')
    await user.click(screen.getByRole('button', { name: 'Cadastrar fornecedor' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Já existe uma conta com esse e-mail',
    )
  })

  it('gera um novo link para quem perdeu o acesso', async () => {
    const { user } = setup()
    await openTab(user, 'Fornecedores')
    await user.click(await screen.findByRole('button', { name: 'Gerar novo link de Ana Doces' }))
    const panel = await screen.findByRole('region', { name: 'Novo link de acesso' })
    expect(panel).toHaveTextContent('Ana Doces')
  })

  it('desativar pede confirmação e conta as reservas canceladas; dá para voltar atrás', async () => {
    const { user } = setup()
    await openTab(user, 'Fornecedores')
    await user.click(await screen.findByRole('button', { name: 'Desativar Biscoitos Bia' }))
    const confirm = screen.getByRole('group', { name: 'Confirmar a desativação de Biscoitos Bia' })
    expect(confirm).toHaveTextContent('reservas futuras dela são canceladas')

    await user.click(within(confirm).getByRole('button', { name: 'Voltar' }))
    expect(screen.queryByRole('group', { name: /Confirmar a desativação/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Desativar Biscoitos Bia' }))
    await user.click(screen.getByRole('button', { name: 'Sim, desativar' }))
    expect(
      await screen.findByText(/Biscoitos Bia foi desativado\. 2 reservas futuras canceladas\./),
    ).toBeInTheDocument()
    expect(within(row('Biscoitos Bia')).getByText(/Desativado/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reativar Biscoitos Bia' })).toBeInTheDocument()
  })

  it('reativa quem estava desativado', async () => {
    const { user } = setup()
    await openTab(user, 'Fornecedores')
    await user.click(await screen.findByRole('button', { name: 'Reativar Zé' }))
    expect(await screen.findByText('Zé foi reativado e já pode entrar.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desativar Zé' })).toBeInTheDocument()
  })

  it('o botão Compartilhar só aparece onde o navegador tem a folha de compartilhar', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const { user } = setup()
    await openTab(user, 'Fornecedores')
    await user.click(await screen.findByRole('button', { name: 'Gerar novo link de Ana Doces' }))
    const panel = await screen.findByRole('region', { name: 'Novo link de acesso' })
    expect(within(panel).queryByRole('button', { name: 'Compartilhar' })).not.toBeInTheDocument()

    cleanup()
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    const second = setup()
    await openTab(second.user, 'Fornecedores')
    await second.user.click(
      await screen.findByRole('button', { name: 'Gerar novo link de Ana Doces' }),
    )
    await second.user.click(await screen.findByRole('button', { name: 'Compartilhar' }))
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Ana Doces') as string }),
    )
    Reflect.deleteProperty(navigator, 'share')
  })

  it('sem internet, avisa e deixa tentar de novo', async () => {
    const { user, state } = setup()
    state.fail = 'NETWORK'
    await openTab(user, 'Fornecedores')
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão')
    state.fail = null
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('heading', { name: 'Ana Doces', level: 3 })).toBeInTheDocument()
  })

  it('sem nenhum fornecedor, avisa', async () => {
    const { user, suppliers } = setup()
    suppliers.splice(0, suppliers.length)
    await openTab(user, 'Fornecedores')
    expect(await screen.findByText('Nenhum fornecedor cadastrado ainda.')).toBeInTheDocument()
  })
})

describe('aba Configurações', () => {
  it('começa fechado e explica o modo', async () => {
    const { user } = setup()
    await openTab(user, 'Configurações')
    expect(await screen.findByRole('button', { name: 'Fechado' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByText(/Só você cadastra fornecedores/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Código de convite')).not.toBeInTheDocument()
  })

  it('ligar o modo com código mostra o código, o link e os botões de entregar', async () => {
    const { user } = setup()
    await openTab(user, 'Configurações')
    await user.click(await screen.findByRole('button', { name: 'Com código' }))

    expect(await screen.findByLabelText('Código de convite')).toHaveTextContent('K7QD-4MXB')
    const panel = screen.getByRole('region', { name: 'Link de convite' })
    expect(within(panel).getByLabelText('Link')).toHaveValue(
      'https://agenda.exemplo/cadastro?codigo=K7QD-4MXB',
    )
    expect(within(panel).getByRole('link', { name: 'Enviar pelo WhatsApp' })).toHaveAttribute(
      'href',
      expect.stringContaining('wa.me'),
    )
    await user.click(within(panel).getByRole('button', { name: 'Copiar link de convite' }))
    expect(await navigator.clipboard.readText()).toBe(
      'https://agenda.exemplo/cadastro?codigo=K7QD-4MXB',
    )
    await user.click(screen.getByRole('button', { name: 'Copiar código' }))
    expect(await screen.findByText('Código copiado.')).toBeInTheDocument()
    expect(await navigator.clipboard.readText()).toBe('K7QD-4MXB')
  })

  it('gerar novo código pede confirmação; voltar mantém o código', async () => {
    const { user } = setup({ settings: { mode: 'invite', inviteCode: 'K7QD4MXA' } })
    await openTab(user, 'Configurações')
    await user.click(await screen.findByRole('button', { name: 'Gerar novo código' }))
    const confirm = screen.getByRole('group', { name: 'Confirmar o novo código' })
    expect(confirm).toHaveTextContent('Quem já criou a conta continua com acesso')

    await user.click(within(confirm).getByRole('button', { name: 'Voltar' }))
    expect(screen.getByLabelText('Código de convite')).toHaveTextContent('K7QD-4MXA')

    await user.click(screen.getByRole('button', { name: 'Gerar novo código' }))
    await user.click(screen.getByRole('button', { name: 'Sim, gerar novo código' }))
    expect(
      await screen.findByText('Novo código gerado. O anterior deixou de valer.'),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Código de convite')).toHaveTextContent('K7QD-4MXB')
  })

  it('o modo livre mostra o alerta; voltar para fechado o esconde', async () => {
    const { user } = setup()
    await openTab(user, 'Configurações')
    await user.click(await screen.findByRole('button', { name: 'Livre' }))
    expect(await screen.findByRole('note')).toHaveTextContent('qualquer pessoa na internet')
    await user.click(screen.getByRole('button', { name: 'Fechado' }))
    expect(await screen.findByText(/Cadastro pela página fechado/)).toBeInTheDocument()
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
  })

  it('sem internet, avisa e deixa tentar de novo', async () => {
    const { user, state } = setup()
    state.fail = 'NETWORK'
    await openTab(user, 'Configurações')
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem conexão')
    state.fail = null
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))
    expect(await screen.findByRole('button', { name: 'Fechado' })).toBeInTheDocument()
  })

  it('não copiar (sem permissão) mostra como fazer na mão', async () => {
    const { user } = setup({ settings: { mode: 'invite', inviteCode: 'K7QD4MXA' } })
    await openTab(user, 'Configurações')
    await screen.findByLabelText('Código de convite')
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('negado'))
    await user.click(screen.getByRole('button', { name: 'Copiar código' }))
    expect(await screen.findByText('Não deu para copiar. Anote o código.')).toBeInTheDocument()
    await user.click(
      within(screen.getByRole('region', { name: 'Link de convite' })).getByRole('button', {
        name: 'Copiar link de convite',
      }),
    )
    expect(await screen.findByText(/Não deu para copiar\. Selecione o link/)).toBeInTheDocument()
  })
})
