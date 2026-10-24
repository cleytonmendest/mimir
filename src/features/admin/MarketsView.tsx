import { useEffect, useState, type FormEvent } from 'react'
import { DEFAULT_CAPACITY, MAX_CAPACITY, MIN_CAPACITY } from '@/domain/booking'
import { NumberStepper } from '@/design-system/components/NumberStepper/NumberStepper'
import { Button } from '@/design-system/components/ui/button'
import { Input } from '@/design-system/components/ui/input'
import { Label } from '@/design-system/components/ui/label'
import { cn } from '@/design-system/utils'
import { NoticeToast } from '@/features/booking/NoticeToast'
import { MarketSearchField } from '@/features/market-search/MarketSearchField'
import { useMarketSearch } from '@/features/market-search/useMarketSearch'
import type { BookingGateway } from '@/lib/supabase/booking-gateway'
import type { Market } from '@/lib/supabase/mappers'
import {
  createMarketsController,
  type MarketsController,
  type MarketsReady,
} from './markets-controller'
import { useController } from './useController'

/** Os mercados e o limite de estandes de cada um: cadastrar, editar, mudar o limite, arquivar. */
export function MarketsView({ gateway, now }: { gateway: BookingGateway; now?: () => Date }) {
  const [controller] = useState(() =>
    createMarketsController({ gateway, ...(now === undefined ? {} : { now }) }),
  )
  const state = useController(controller)

  useEffect(() => {
    void controller.start()
  }, [controller])

  if (state.status === 'loading') {
    return (
      <p role="status" className="mt-6 text-muted-foreground">
        Carregando…
      </p>
    )
  }

  if (state.status === 'failed') {
    return (
      <div className="mt-6 grid gap-3">
        <p role="alert" className="text-destructive">
          {state.message}
        </p>
        <div>
          <Button
            onClick={() => {
              void controller.start()
            }}
          >
            Tentar de novo
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mt-4 grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:items-start">
        <NewMarketForm state={state} controller={controller} />
        <section aria-labelledby="markets-admin-title" className="min-w-0">
          <h2
            id="markets-admin-title"
            className="font-display text-2xl leading-tight font-semibold"
          >
            Seus mercados
          </h2>
          <p className="text-muted-foreground">
            O limite vale para todos os dias do mercado. Reduzir o limite não cancela reservas que
            já existem.
          </p>
          <MarketRows state={state} controller={controller} />
        </section>
      </div>
      <NoticeToast
        notice={state.notice}
        onClose={() => {
          controller.dismissNotice()
        }}
      />
    </>
  )
}

/** As linhas de mercado, com a busca (o hook precisa ficar fora dos retornos antecipados da tela). */
function MarketRows({ state, controller }: { state: MarketsReady; controller: MarketsController }) {
  const search = useMarketSearch(state.markets)
  if (state.markets.length === 0) return <p className="mt-3">Nenhum mercado cadastrado ainda.</p>
  return (
    <>
      <MarketSearchField search={search} />
      <ul className="mt-3 grid gap-3">
        {search.shown.map((market) => (
          <MarketRow key={market.id} market={market} state={state} controller={controller} />
        ))}
      </ul>
    </>
  )
}

function NewMarketForm({
  state,
  controller,
}: {
  state: MarketsReady
  controller: MarketsController
}) {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY)
  // O erro de validação é do formulário aberto: o de edição aparece na linha do mercado.
  const error = state.editing === null ? state.formError : null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await controller.create({ name, address, capacity })) {
      setName('')
      setAddress('')
      setCapacity(DEFAULT_CAPACITY)
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void submit(event)
      }}
      aria-labelledby="new-market-title"
      className="grid gap-3 rounded-xl border border-border bg-card p-4"
    >
      <h2 id="new-market-title" className="font-display text-2xl leading-tight font-semibold">
        Novo mercado
      </h2>
      <div className="grid gap-1.5">
        <Label htmlFor="new-market-name">Nome</Label>
        <Input
          id="new-market-name"
          value={name}
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new-market-address">Endereço (opcional)</Label>
        <Input
          id="new-market-address"
          value={address}
          maxLength={200}
          onChange={(event) => {
            setAddress(event.target.value)
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm leading-none font-medium">Estandes por dia</span>
        <NumberStepper
          label="Estandes por dia do novo mercado"
          value={capacity}
          min={MIN_CAPACITY}
          max={MAX_CAPACITY}
          onChange={setCapacity}
        />
      </div>
      {error !== null && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={state.busy}>
        Cadastrar mercado
      </Button>
    </form>
  )
}

function MarketRow({
  market,
  state,
  controller,
}: {
  market: Market
  state: MarketsReady
  controller: MarketsController
}) {
  const editing = state.editing === market.id
  const archiving = state.confirmingArchive === market.id

  const stepper = (
    <NumberStepper
      label={`Limite de estandes por dia, ${market.name}`}
      value={market.capacity}
      min={MIN_CAPACITY}
      max={MAX_CAPACITY}
      unit="por dia"
      onChange={(value) => {
        void controller.setCapacity(market.id, value)
      }}
    />
  )

  const archiveControl = archiving ? null : market.archived ? (
    <Button
      variant="outline"
      disabled={state.busy}
      aria-label={`Reativar ${market.name}`}
      onClick={() => {
        void controller.setArchived(market.id, false)
      }}
    >
      Reativar
    </Button>
  ) : (
    <Button
      variant="outline"
      disabled={state.busy}
      aria-label={`Arquivar ${market.name}`}
      onClick={() => {
        controller.askArchive(market.id)
      }}
    >
      Arquivar
    </Button>
  )

  // Com dezenas de lojas, cada uma ocupa o mínimo de altura: no computador, uma linha só (nome,
  // limite, Editar, Arquivar); no celular, duas (nome e Editar; limite e Arquivar).
  return (
    <li
      className={cn(
        'grid gap-3 rounded-xl border border-border bg-card p-3',
        !editing &&
          'grid-cols-[minmax(0,1fr)_auto] gap-y-2 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-center md:gap-x-3',
      )}
    >
      {editing ? (
        <>
          <EditForm market={market} state={state} controller={controller} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            {stepper}
            {archiveControl}
          </div>
        </>
      ) : (
        <>
          <div className="min-w-0">
            <h3 className="font-display text-xl leading-tight font-semibold">{market.name}</h3>
            {market.address !== null && (
              <p className="text-sm text-muted-foreground">{market.address}</p>
            )}
            {market.archived && (
              <p className="mt-1 text-sm font-semibold text-muted-foreground">
                Arquivado: não aceita novas reservas
              </p>
            )}
          </div>
          <div className="max-md:col-start-1 max-md:row-start-2">{stepper}</div>
          <Button
            variant="outline"
            className="max-md:col-start-2 max-md:row-start-1"
            disabled={state.busy}
            aria-label={`Editar ${market.name}`}
            onClick={() => {
              controller.startEdit(market.id)
            }}
          >
            Editar
          </Button>
          <div className="max-md:col-start-2 max-md:row-start-2">{archiveControl}</div>
        </>
      )}

      {archiving && (
        <div role="group" aria-label="Confirmar arquivamento" className="col-span-full grid gap-2">
          <p className="max-w-[60ch] text-sm">
            Arquivar este mercado? Ele deixa de aparecer para os fornecedores e não aceita novas
            reservas. As que já existem continuam.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={state.busy}
              onClick={() => {
                void controller.setArchived(market.id, true)
              }}
            >
              Sim, arquivar
            </Button>
            <Button
              variant="outline"
              disabled={state.busy}
              onClick={() => {
                controller.keepActive()
              }}
            >
              Manter
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function EditForm({
  market,
  state,
  controller,
}: {
  market: Market
  state: MarketsReady
  controller: MarketsController
}) {
  const [name, setName] = useState(market.name)
  const [address, setAddress] = useState(market.address ?? '')

  return (
    <form
      aria-label={`Editar ${market.name}`}
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        void controller.save(market.id, { name, address })
      }}
    >
      <div className="grid gap-1.5">
        <Label htmlFor={`name-${market.id}`}>Nome</Label>
        <Input
          id={`name-${market.id}`}
          value={name}
          maxLength={100}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`address-${market.id}`}>Endereço (opcional)</Label>
        <Input
          id={`address-${market.id}`}
          value={address}
          maxLength={200}
          onChange={(event) => {
            setAddress(event.target.value)
          }}
        />
      </div>
      {state.formError !== null && (
        <p role="alert" className="text-destructive">
          {state.formError}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={state.busy}>
          Salvar
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            controller.cancelEdit()
          }}
        >
          Cancelar
        </Button>
      </div>
    </form>
  )
}
