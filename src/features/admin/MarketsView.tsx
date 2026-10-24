import { useEffect, useState, type FormEvent } from 'react'
import { DEFAULT_CAPACITY, MAX_CAPACITY, MIN_CAPACITY } from '@/domain/booking'
import {
  MAX_ADDRESS_LENGTH,
  MAX_NAME_LENGTH,
  validateMarketAddress,
  validateMarketName,
} from '@/domain/market'
import { InlineConfirm } from '@/design-system/components/InlineConfirm/InlineConfirm'
import { useFocusReturn } from '@/design-system/components/InlineConfirm/useFocusReturn'
import { NumberStepper } from '@/design-system/components/NumberStepper/NumberStepper'
import { Button } from '@/design-system/components/ui/button'
import { TextField } from '@/design-system/components/TextField/TextField'
import { cn } from '@/design-system/utils'
import { NoticeToast } from '@/features/booking/NoticeToast'
import { checkAll, useValidatedField } from '@/features/forms/useValidatedField'
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
  const name = useValidatedField(validateMarketName)
  const address = useValidatedField(validateMarketAddress)
  const [capacity, setCapacity] = useState(DEFAULT_CAPACITY)
  // O erro de validação é do formulário aberto: o de edição aparece na linha do mercado.
  const error = state.editing === null ? state.formError : null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!checkAll([name, address])) return
    if (await controller.create({ name: name.value, address: address.value, capacity })) {
      name.reset()
      address.reset()
      setCapacity(DEFAULT_CAPACITY)
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event)
      }}
      aria-labelledby="new-market-title"
      className="grid gap-3 rounded-xl border border-border bg-card p-4"
    >
      <h2 id="new-market-title" className="font-display text-2xl leading-tight font-semibold">
        Novo mercado
      </h2>
      <TextField
        id="new-market-name"
        label="Nome"
        maxLength={MAX_NAME_LENGTH}
        value={name.value}
        error={name.error}
        inputRef={name.ref}
        onChange={(event) => {
          name.change(event.target.value)
        }}
        onFocus={name.focus}
        onBlur={name.blur}
      />
      <TextField
        id="new-market-address"
        label="Endereço (opcional)"
        maxLength={MAX_ADDRESS_LENGTH}
        value={address.value}
        error={address.error}
        inputRef={address.ref}
        onChange={(event) => {
          address.change(event.target.value)
        }}
        onFocus={address.focus}
        onBlur={address.blur}
      />
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
  const archiveTrigger = useFocusReturn<HTMLButtonElement>(archiving)

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
      ref={archiveTrigger}
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
        <InlineConfirm
          label="Confirmar arquivamento"
          title={`Arquivar ${market.name}?`}
          description="Ele deixa de aparecer para os fornecedores e não aceita novas reservas. As que já existem continuam."
          confirmLabel="Sim, arquivar"
          cancelLabel="Manter"
          busy={state.busy}
          className="col-span-full"
          onConfirm={() => {
            void controller.setArchived(market.id, true)
          }}
          onCancel={() => {
            controller.keepActive()
          }}
        />
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
  const name = useValidatedField(validateMarketName, market.name)
  const address = useValidatedField(validateMarketAddress, market.address ?? '')

  return (
    <form
      noValidate
      aria-label={`Editar ${market.name}`}
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!checkAll([name, address])) return
        void controller.save(market.id, { name: name.value, address: address.value })
      }}
    >
      <TextField
        id={`name-${market.id}`}
        label="Nome"
        maxLength={MAX_NAME_LENGTH}
        value={name.value}
        error={name.error}
        inputRef={name.ref}
        onChange={(event) => {
          name.change(event.target.value)
        }}
        onFocus={name.focus}
        onBlur={name.blur}
      />
      <TextField
        id={`address-${market.id}`}
        label="Endereço (opcional)"
        maxLength={MAX_ADDRESS_LENGTH}
        value={address.value}
        error={address.error}
        inputRef={address.ref}
        onChange={(event) => {
          address.change(event.target.value)
        }}
        onFocus={address.focus}
        onBlur={address.blur}
      />
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
