import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { makeVisit } from '@/domain/testing'
import type { UserProfile } from '@/lib/supabase/mappers'
import type { VisitsGateway } from '@/lib/supabase/visits-gateway'
import type { Clock } from './clock'
import { formatTime } from './format'
import { createFakeVisitsGateway, market, type FakeServer } from './testing'
import { TodayScreen } from './TodayScreen'

// 2026-10-21 é quarta-feira.
const NOW = '2026-10-21T14:00:00.000Z'
const clock: Clock = () => ({ now: NOW, today: '2026-10-21' })
const profile: UserProfile = { id: 'repo-ana', role: 'repositor', fullName: 'Ana' }

const MARKETS = [
  market('market-a', 'Mercado A', 'Rua das Flores, 10'),
  market('market-b', 'Mercado B'),
]
const visitA = () => makeVisit({ id: 'v-a', marketId: 'market-a', date: '2026-10-21', order: 0 })
const visitB = () => makeVisit({ id: 'v-b', marketId: 'market-b', date: '2026-10-21', order: 1 })

/** `prepare` roda antes de renderizar, porque o render já dispara a carga das visitas. */
function setup(
  seed: Partial<FakeServer> = {},
  prepare: (fake: ReturnType<typeof createFakeVisitsGateway>) => void = () => undefined,
) {
  const fake = createFakeVisitsGateway({ markets: MARKETS, ...seed })
  prepare(fake)
  render(<TodayScreen profile={profile} gateway={fake.gateway} clock={clock} />)
  return { ...fake, user: userEvent.setup() }
}

const card = (name: string) =>
  within(screen.getByRole('heading', { name, level: 3 }).closest('li') as HTMLElement)

describe('Hoje', () => {
  it('mostra "carregando" até as visitas chegarem', async () => {
    setup({ visits: [visitA()] })

    expect(screen.getByRole('status')).toHaveTextContent('Carregando visitas…')
    expect(await screen.findByRole('heading', { name: 'Mercado A' })).toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('mostra o dia e as visitas na ordem da rota, com mercado, endereço e status', async () => {
    setup({ visits: [visitB(), visitA()] })

    await screen.findByRole('heading', { name: 'Mercado A' })

    expect(screen.getByRole('heading', { name: 'Hoje', level: 2 })).toBeInTheDocument()
    expect(screen.getByText('Quarta-feira, 21 de outubro')).toBeInTheDocument()
    const items = within(screen.getByRole('list', { name: 'Visitas de hoje' })).getAllByRole(
      'listitem',
    )
    expect(items.map((item) => within(item).getByRole('heading').textContent)).toEqual([
      'Mercado A',
      'Mercado B',
    ])
    expect(card('Mercado A').getByText('Rua das Flores, 10')).toBeInTheDocument()
    expect(card('Mercado A').getByText('Planejada')).toBeInTheDocument()
  })

  it('sem visitas hoje, avisa em vez de mostrar uma tela vazia', async () => {
    setup()

    expect(await screen.findByText('Nenhuma visita para hoje.')).toBeInTheDocument()
  })

  it('falha ao carregar: avisa, e "Tentar de novo" traz as visitas', async () => {
    const { user } = setup({ visits: [visitA()] }, (fake) => {
      fake.failNext('listVisits', new Error('sem rede'))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Verifique a internet')

    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByRole('heading', { name: 'Mercado A' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('check-in e check-out', () => {
  it('check-in: a visita passa a "Em andamento", mostra a hora de entrada e oferece o check-out', async () => {
    const { user, visit } = setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })

    await user.click(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' }))

    expect(await card('Mercado A').findByText('Em andamento')).toBeInTheDocument()
    expect(card('Mercado A').getByText(`Entrada ${formatTime(NOW)}`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fazer check-out em Mercado A' })).toBeInTheDocument()
    expect(visit('v-a')).toMatchObject({ status: 'in_progress', checkInAt: NOW })
  })

  it('check-out com observação: a visita fica "Feita" com horários e observação, sem mais ações', async () => {
    const { user, visit } = setup({
      visits: [{ ...visitA(), status: 'in_progress', checkInAt: '2026-10-21T10:00:00.000Z' }],
    })
    await screen.findByRole('heading', { name: 'Mercado A' })

    await user.click(screen.getByRole('button', { name: 'Fazer check-out em Mercado A' }))
    await user.type(screen.getByLabelText('Observação (opcional)'), 'Gôndola reposta')
    await user.click(screen.getByRole('button', { name: 'Concluir visita' }))

    expect(await card('Mercado A').findByText('Feita')).toBeInTheDocument()
    expect(card('Mercado A').getByText('Observação: Gôndola reposta')).toBeInTheDocument()
    expect(
      card('Mercado A').getByText(
        `Entrada ${formatTime('2026-10-21T10:00:00.000Z')} · Saída ${formatTime(NOW)}`,
      ),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mercado A/ })).not.toBeInTheDocument()
    expect(visit('v-a')).toMatchObject({ status: 'done', note: 'Gôndola reposta' })
  })

  it('"Voltar" fecha o formulário sem gravar nada', async () => {
    const { user, saved } = setup({
      visits: [{ ...visitA(), status: 'in_progress', checkInAt: '2026-10-21T10:00:00.000Z' }],
    })
    await screen.findByRole('heading', { name: 'Mercado A' })
    await user.click(screen.getByRole('button', { name: 'Fazer check-out em Mercado A' }))

    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    expect(screen.queryByLabelText('Observação (opcional)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fazer check-out em Mercado A' })).toBeInTheDocument()
    expect(saved).toEqual([])
  })
})

describe('"não fui"', () => {
  it('sem motivo não confirma: mostra o que falta, marca o campo e não grava', async () => {
    const { user, saved } = setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })

    await user.click(screen.getByRole('button', { name: 'Não fui em Mercado A' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Informe o motivo de não ter ido.')
    expect(screen.getByLabelText('Por que não foi?')).toBeInvalid()
    expect(saved).toEqual([])
  })

  it('com motivo, a visita fica "Não foi" e o motivo aparece', async () => {
    const { user, visit } = setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })

    await user.click(screen.getByRole('button', { name: 'Não fui em Mercado A' }))
    await user.type(screen.getByLabelText('Por que não foi?'), 'Loja fechada')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await card('Mercado A').findByText('Não foi')).toBeInTheDocument()
    expect(card('Mercado A').getByText('Motivo: Loja fechada')).toBeInTheDocument()
    expect(visit('v-a')).toMatchObject({ status: 'not_done', skipReason: 'Loja fechada' })
  })
})

describe('enquanto grava e quando dá errado', () => {
  it('trava as ações de todas as visitas enquanto uma é gravada (sem toque duplo)', async () => {
    const fake = createFakeVisitsGateway({ markets: MARKETS, visits: [visitA(), visitB()] })
    let release: () => void = () => undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const slow: VisitsGateway = {
      ...fake.gateway,
      saveChanges: async (changes) => {
        await hold
        return fake.gateway.saveChanges(changes)
      },
    }
    render(<TodayScreen profile={profile} gateway={slow} clock={clock} />)
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Mercado A' })

    await user.click(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' }))

    expect(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' })).toHaveTextContent(
      'Salvando…',
    )
    expect(screen.getByRole('button', { name: 'Fazer check-in em Mercado B' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Não fui em Mercado B' })).toBeDisabled()

    release()
    expect(await card('Mercado A').findByText('Em andamento')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fazer check-in em Mercado B' })).toBeEnabled()
  })

  it('se o líder cancelou a visita enquanto ela estava aberta: avisa e ela some da lista', async () => {
    const { user, visit } = setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })
    visit('v-a').status = 'cancelled' // o líder cancela no servidor

    await user.click(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('mudou enquanto você a abria')
    expect(await screen.findByText('Nenhuma visita para hoje.')).toBeInTheDocument()
  })

  it('o aviso de erro pode ser fechado', async () => {
    const { user, failNext } = setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })
    failNext('saveChanges', new Error('sem rede'))
    await user.click(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível salvar')

    await user.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' })).toBeEnabled()
  })
})
