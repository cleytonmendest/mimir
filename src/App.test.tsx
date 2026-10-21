import 'fake-indexeddb/auto'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IDBFactory } from 'fake-indexeddb'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeVisit } from '@/domain/testing'
import { createOfflineRuntime } from '@/lib/offline/runtime'
import { createFakeSyncGateway } from '@/lib/offline/testing'
import App from './App'
import { ana, createFakeGateway, lia } from './features/auth/testing'
import { createFakeVisitsGateway, market } from './features/today/testing'

const ACCOUNTS = { 'ana@test.dev': ana, 'lia@test.dev': lia }
const clock = () => ({ now: '2026-10-21T14:00:00.000Z', today: '2026-10-21' })

beforeEach(() => {
  ;(globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory()
})

async function world() {
  const fake = createFakeVisitsGateway({
    markets: [market('market-a', 'Mercado A')],
    visits: [
      makeVisit({ id: 'v-a', repositorId: 'u-ana', marketId: 'market-a', date: '2026-10-21' }),
    ],
  })
  const sync = createFakeSyncGateway(fake.server.visits, { actor: ana.profile! })
  const runtime = await createOfflineRuntime(sync.gateway)
  return { visits: fake.gateway, runtime, sync }
}

describe('App', () => {
  it('abre e mostra o título, mesmo antes de saber quem está logado', async () => {
    const { visits, runtime } = await world()
    render(<App auth={createFakeGateway()} visits={visits} runtime={runtime} clock={clock} />)
    expect(screen.getByRole('heading', { name: 'Rota do repositor' })).toBeInTheDocument()
  })

  it('sem sessão pede o login e não mostra visitas', async () => {
    const { visits, runtime } = await world()
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS })}
        visits={visits}
        runtime={runtime}
        clock={clock}
      />,
    )

    expect(await screen.findByLabelText('E-mail')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Hoje' })).not.toBeInTheDocument()
  })

  it('repositor logado vê a tela Hoje com as visitas dele', async () => {
    const { visits, runtime } = await world()
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })}
        visits={visits}
        runtime={runtime}
        clock={clock}
      />,
    )

    expect(await screen.findByRole('heading', { name: 'Hoje' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Mercado A' })).toBeInTheDocument()
    expect(await screen.findByText('Tudo enviado')).toBeInTheDocument()
  })

  it('líder logado não cai na tela de visitas do repositor', async () => {
    const { visits, runtime } = await world()
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'lia@test.dev' })}
        visits={visits}
        runtime={runtime}
        clock={clock}
      />,
    )

    expect(await screen.findByText('Lia · Líder')).toBeInTheDocument()
    expect(screen.getByText(/A visão do líder/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Hoje' })).not.toBeInTheDocument()
  })
})

describe('sem sinal', () => {
  it('o repositor abre o app, sem o servidor responder, e vê a lista que ficou guardada', async () => {
    const { visits, runtime } = await world()
    // Um dia anterior, com sinal: a lista e a identidade ficaram guardadas no aparelho.
    const previous = await runtime.openUser('u-ana')
    await previous.store.saveSnapshot({
      visits: [
        makeVisit({ id: 'v-a', repositorId: 'u-ana', marketId: 'market-a', date: '2026-10-21' }),
      ],
      markets: [market('market-a', 'Mercado A')],
      route: [],
      fetchedAt: '2026-10-21T10:00:00.000Z',
    })
    previous.close()
    await runtime.device.saveIdentity({
      profile: ana.profile!,
      savedAt: '2026-10-21T10:00:00.000Z',
    })
    // Agora o SDK nunca responde e o servidor está fora.
    const never = new Promise<void>(() => undefined)
    const auth = createFakeGateway({
      accounts: ACCOUNTS,
      signedInAs: 'ana@test.dev',
      holdSession: never,
    })
    const offlineVisits = {
      ...visits,
      listVisits: () => Promise.reject(new Error('sem rede')),
      listStandardRoute: () => Promise.reject(new Error('sem rede')),
      listMarkets: () => Promise.reject(new Error('sem rede')),
    }
    render(
      <App
        auth={auth}
        visits={offlineVisits}
        runtime={runtime}
        clock={clock}
        sessionTimeoutMs={50}
      />,
    )

    expect(
      await screen.findByRole('heading', { name: 'Mercado A' }, { timeout: 3_000 }),
    ).toBeInTheDocument()
    expect(screen.getByText('Ana · Repositor')).toBeInTheDocument()
    expect(await screen.findByText(/Esta é a lista guardada neste aparelho/)).toBeInTheDocument()
  })

  it('o líder, sem sinal, é avisado de que a visão dele precisa de internet', async () => {
    const { visits, runtime } = await world()
    await runtime.device.saveIdentity({
      profile: lia.profile!,
      savedAt: '2026-10-21T10:00:00.000Z',
    })
    const auth = createFakeGateway({
      accounts: ACCOUNTS,
      signedInAs: 'lia@test.dev',
      holdSession: new Promise<void>(() => undefined),
    })
    render(<App auth={auth} visits={visits} runtime={runtime} clock={clock} />)

    expect(
      await screen.findByText(/A visão do líder precisa de internet/, undefined, {
        timeout: 8_000,
      }),
    ).toBeInTheDocument()
  })

  it('sair com registros ainda não enviados pede confirmação', async () => {
    const { visits, runtime } = await world()
    const user = userEvent.setup()
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })}
        visits={visits}
        runtime={runtime}
        clock={clock}
      />,
    )
    await screen.findByRole('heading', { name: 'Mercado A' })
    const session = await runtime.openUser('u-ana')
    await session.store.enqueue([
      { type: 'checkIn', visitId: 'v-a', occurredAt: '2026-10-21T12:00:00.000Z' },
    ])
    session.close()

    await user.click(screen.getByRole('button', { name: 'Sair' }))

    expect(await screen.findByRole('group', { name: 'Confirmar saída' })).toHaveTextContent(
      '1 registro',
    )
  })
})

describe('o aparelho não deixa guardar dados', () => {
  it('avisa em vez de abrir sem fila, e "Tentar de novo" recupera', async () => {
    const { visits, runtime } = await world()
    const open = runtime.openUser
    vi.spyOn(runtime, 'openUser').mockRejectedValueOnce(new Error('armazenamento indisponível'))
    vi.spyOn(runtime, 'openUser').mockImplementation(open)
    const user = userEvent.setup()
    render(
      <App
        auth={createFakeGateway({ accounts: ACCOUNTS, signedInAs: 'ana@test.dev' })}
        visits={visits}
        runtime={runtime}
        clock={clock}
      />,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('armazenamento deste aparelho')

    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }))

    expect(await screen.findByRole('heading', { name: 'Mercado A' })).toBeInTheDocument()
  })
})
