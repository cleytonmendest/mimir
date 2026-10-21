import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeVisit } from '@/domain/testing'
import { OfflineStoreError } from '@/lib/offline/store'
import type { UserProfile } from '@/lib/supabase/mappers'
import { formatTime } from './format'
import { createDevice, market, NOW, type FakeServer } from './testing'
import { TodayScreen } from './TodayScreen'

const profile: UserProfile = { id: 'repo-ana', role: 'repositor', fullName: 'Ana' }

const MARKETS = [
  market('market-a', 'Mercado A', 'Rua das Flores, 10'),
  market('market-b', 'Mercado B'),
]
const visitA = () => makeVisit({ id: 'v-a', marketId: 'market-a', date: '2026-10-21', order: 0 })
const visitB = () => makeVisit({ id: 'v-b', marketId: 'market-b', date: '2026-10-21', order: 1 })

let device: Awaited<ReturnType<typeof createDevice>> | undefined

afterEach(() => {
  device?.close()
  device = undefined
})

/** `prepare` roda antes de renderizar, porque o render já dispara a carga das visitas. */
async function setup(
  seed: Partial<FakeServer> = {},
  prepare: (current: Awaited<ReturnType<typeof createDevice>>) => void = () => undefined,
) {
  device = await createDevice({ markets: MARKETS, ...seed })
  prepare(device)
  render(
    <TodayScreen
      profile={profile}
      gateway={device.fake.gateway}
      session={{ ...device.session, deviceId: 'device-1' }}
      clock={device.clock}
    />,
  )
  return { ...device, user: userEvent.setup() }
}

const card = (name: string) =>
  within(screen.getByRole('heading', { name, level: 3 }).closest('li') as HTMLElement)

describe('Hoje', () => {
  it('mostra "carregando" até as visitas chegarem', async () => {
    await setup({ visits: [visitA()] })

    expect(screen.getByRole('status')).toHaveTextContent('Carregando visitas…')
    expect(await screen.findByRole('heading', { name: 'Mercado A' })).toBeInTheDocument()
    expect(screen.queryByText('Carregando visitas…')).not.toBeInTheDocument()
  })

  it('mostra o dia e as visitas na ordem da rota, com mercado, endereço e status', async () => {
    await setup({ visits: [visitB(), visitA()] })

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
    await setup()

    expect(await screen.findByText('Nenhuma visita para hoje.')).toBeInTheDocument()
  })

  it('primeira vez sem rede: avisa, e "Tentar de novo" traz as visitas quando há sinal', async () => {
    const { user, net } = await setup({ visits: [visitA()] }, (current) => {
      current.net.online = false
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('Verifique a internet')

    net.online = true
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByRole('heading', { name: 'Mercado A' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('o estado do envio', () => {
  it('sem nada a enviar: "Tudo enviado"', async () => {
    await setup({ visits: [visitA()] })

    expect(await screen.findByText('Tudo enviado')).toBeInTheDocument()
  })

  it('com sinal, o check-in aparece na hora e chega ao servidor', async () => {
    const { user, fake } = await setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })

    await user.click(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' }))

    expect(await card('Mercado A').findByText('Em andamento')).toBeInTheDocument()
    expect(card('Mercado A').getByText(`Entrada ${formatTime(NOW)}`)).toBeInTheDocument()
    await waitFor(() => expect(fake.visit('v-a')).toMatchObject({ status: 'in_progress' }))
    await waitFor(() => expect(screen.getByText('Tudo enviado')).toBeInTheDocument())
    expect(card('Mercado A').queryByText(/Ainda não foi enviado/)).not.toBeInTheDocument()
  })

  it('sem sinal, o trabalho fica guardado e a tela diz o que falta enviar', async () => {
    const { user, fake, net } = await setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })
    net.online = false

    await user.click(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' }))

    expect(await card('Mercado A').findByText('Em andamento')).toBeInTheDocument()
    expect(await screen.findByText('1 registro para enviar')).toBeInTheDocument()
    expect(screen.getByText(/Sem conexão\. Tentando de novo às/)).toBeInTheDocument()
    expect(
      card('Mercado A').getByText('Registrado neste aparelho. Ainda não foi enviado.'),
    ).toBeInTheDocument()
    expect(fake.visit('v-a').status).toBe('planned')
  })

  it('quando o sinal volta, "Enviar agora" leva o que ficou e a tela volta a "Tudo enviado"', async () => {
    const { user, fake, net } = await setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })
    net.online = false
    await user.click(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' }))
    await screen.findByText('1 registro para enviar')
    net.online = true

    await user.click(screen.getByRole('button', { name: 'Enviar agora' }))

    await waitFor(() => expect(fake.visit('v-a').status).toBe('in_progress'))
    expect(await screen.findByText('Tudo enviado')).toBeInTheDocument()
    expect(screen.getByText(/Último envio às/)).toBeInTheDocument()
    expect(card('Mercado A').queryByText(/Ainda não foi enviado/)).not.toBeInTheDocument()
  })

  it('abrir o app sem sinal mostra a lista guardada, avisando que ela é do aparelho', async () => {
    const { net, open, fake, clock } = await setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })
    net.online = false
    const reopened = await open()
    cleanup() // o app foi fechado

    render(
      <TodayScreen
        profile={profile}
        gateway={fake.gateway}
        session={{ ...reopened, deviceId: 'device-1' }}
        clock={clock}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Mercado A' })).toBeInTheDocument()
    expect(await screen.findByText(/Esta é a lista guardada neste aparelho/)).toBeInTheDocument()
  })

  it('avisa quando o relógio do celular está errado por mais de 5 minutos', async () => {
    const { user, net, session } = await setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })
    await session.store.ack({
      applied: [],
      rejected: [],
      visits: [],
      serverNow: '2026-10-21T14:12:00.000Z', // o servidor está 12 min à frente
      deviceNow: NOW,
    })
    net.online = true
    await user.click(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' }))

    expect(
      await screen.findByText(/relógio do seu celular está 12 min atrasado/),
    ).toBeInTheDocument()
  })

  it('"Detalhes do envio" traz o que o suporte pergunta e dá para copiar', async () => {
    const { user } = await setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })
    const clipboard = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: clipboard },
      configurable: true,
    })

    await user.click(screen.getByText('Detalhes do envio'))

    expect(screen.getByText(/Aparelho: device-1/)).toBeInTheDocument()
    expect(screen.getByText(/Versão do app:/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copiar' }))
    expect(clipboard).toHaveBeenCalledWith(expect.stringContaining('Aparelho: device-1'))
    expect(await screen.findByText('Copiado.')).toBeInTheDocument()
  })

  it('copiar sem permissão não quebra: o texto continua na tela para selecionar', async () => {
    const { user } = await setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('negado')) },
      configurable: true,
    })
    await user.click(screen.getByText('Detalhes do envio'))

    await user.click(screen.getByRole('button', { name: 'Copiar' }))

    expect(screen.queryByText('Copiado.')).not.toBeInTheDocument()
    expect(screen.getByText(/Aparelho: device-1/)).toBeInTheDocument()
  })
})

describe('check-in e check-out', () => {
  it('check-out com observação: a visita fica "Feita" com horários e observação, sem mais ações', async () => {
    const { user, fake } = await setup({
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
    await waitFor(() =>
      expect(fake.visit('v-a')).toMatchObject({ status: 'done', note: 'Gôndola reposta' }),
    )
  })

  it('"Voltar" fecha o formulário sem guardar nada', async () => {
    const { user, session } = await setup({
      visits: [{ ...visitA(), status: 'in_progress', checkInAt: '2026-10-21T10:00:00.000Z' }],
    })
    await screen.findByRole('heading', { name: 'Mercado A' })
    await user.click(screen.getByRole('button', { name: 'Fazer check-out em Mercado A' }))

    await user.click(screen.getByRole('button', { name: 'Voltar' }))

    expect(screen.queryByLabelText('Observação (opcional)')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fazer check-out em Mercado A' })).toBeInTheDocument()
    expect(await session.store.pending()).toEqual([])
  })
})

describe('"não fui"', () => {
  it('sem motivo não confirma: mostra o que falta, marca o campo e não guarda', async () => {
    const { user, session } = await setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })

    await user.click(screen.getByRole('button', { name: 'Não fui em Mercado A' }))
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Informe o motivo de não ter ido.')
    expect(screen.getByLabelText('Por que não foi?')).toBeInvalid()
    expect(await session.store.pending()).toEqual([])
  })

  it('com motivo, a visita fica "Não foi" e o motivo aparece', async () => {
    const { user, fake } = await setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })

    await user.click(screen.getByRole('button', { name: 'Não fui em Mercado A' }))
    await user.type(screen.getByLabelText('Por que não foi?'), 'Loja fechada')
    await user.click(screen.getByRole('button', { name: 'Confirmar' }))

    expect(await card('Mercado A').findByText('Não foi')).toBeInTheDocument()
    expect(card('Mercado A').getByText('Motivo: Loja fechada')).toBeInTheDocument()
    await waitFor(() =>
      expect(fake.visit('v-a')).toMatchObject({ status: 'not_done', skipReason: 'Loja fechada' }),
    )
  })
})

describe('quando o servidor discorda', () => {
  it('o líder cancelou a visita com o celular sem sinal: a recusa é explicada e pode ser dispensada', async () => {
    const { user, fake, net } = await setup({ visits: [visitA(), visitB()] })
    await screen.findByRole('heading', { name: 'Mercado A' })
    net.online = false
    await user.click(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' }))
    await screen.findByText('1 registro para enviar')
    fake.visit('v-a').status = 'cancelled' // o líder cancela no servidor
    net.online = true

    await user.click(screen.getByRole('button', { name: 'Enviar agora' }))

    const alert = await screen.findByText(
      'Check-in no Mercado A: a visita foi cancelada pelo líder.',
    )
    expect(alert).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Mercado A' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Mercado B' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Entendi' }))

    expect(
      screen.queryByText('Check-in no Mercado A: a visita foi cancelada pelo líder.'),
    ).not.toBeInTheDocument()
  })
})

describe('enquanto guarda e quando dá errado', () => {
  it('trava as ações de todas as visitas enquanto uma é guardada (sem toque duplo)', async () => {
    const { user, session } = await setup({ visits: [visitA(), visitB()] })
    await screen.findByRole('heading', { name: 'Mercado A' })
    let release: () => void = () => undefined
    const hold = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = session.store.enqueue.bind(session.store)
    vi.spyOn(session.store, 'enqueue').mockImplementation(async (drafts) => {
      await hold
      return original(drafts)
    })

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

  it('sem espaço no aparelho: avisa em vez de fingir que registrou, e o aviso pode ser fechado', async () => {
    const { user, session } = await setup({ visits: [visitA()] })
    await screen.findByRole('heading', { name: 'Mercado A' })
    vi.spyOn(session.store, 'enqueue').mockRejectedValueOnce(
      new OfflineStoreError('QUOTA', 'cheio'),
    )

    await user.click(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível guardar neste aparelho',
    )
    expect(card('Mercado A').getByText('Planejada')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Fechar' }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fazer check-in em Mercado A' })).toBeEnabled()
  })
})
