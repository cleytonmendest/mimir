import { useEffect, useState, type FormEvent } from 'react'
import { MAX_SUPPLIER_NAME_LENGTH } from '@/domain/access'
import { Button } from '@/design-system/components/ui/button'
import { Input } from '@/design-system/components/ui/input'
import { Label } from '@/design-system/components/ui/label'
import { AccessLinkPanel } from '@/features/access/AccessLinkPanel'
import { activationMessage } from '@/features/access/share'
import { NoticeToast } from '@/features/booking/NoticeToast'
import type { AccessGateway } from '@/lib/supabase/access-gateway'
import type { Supplier } from '@/lib/supabase/mappers'
import {
  createSuppliersController,
  type SuppliersController,
  type SuppliersReady,
} from './suppliers-controller'
import { useController } from './useController'

/**
 * Os fornecedores: o administrador cadastra (nome e e-mail), recebe um link para o fornecedor
 * escolher a senha, gera outro link quando alguém perde o acesso e desativa quem não deve mais reservar.
 */
export function SuppliersView({
  gateway,
  origin = window.location.origin,
}: {
  gateway: AccessGateway
  origin?: string
}) {
  const [controller] = useState(() => createSuppliersController({ gateway, origin }))
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
        <div className="grid gap-4">
          <NewSupplierForm state={state} controller={controller} />
          {state.offer !== null && (
            <div className="grid gap-2">
              <AccessLinkPanel
                title={state.offer.firstAccess ? 'Link de acesso' : 'Novo link de acesso'}
                hint={`Envie para ${state.offer.supplierName}. Ele abre o link e escolhe a própria senha. O link vale por pouco tempo e só pode ser usado uma vez; se vencer, gere outro.`}
                url={state.offer.url}
                message={activationMessage(state.offer.supplierName, state.offer.url)}
                shareTitle="Acesso à Agenda de Degustações"
              />
              <div>
                <Button
                  variant="ghost"
                  onClick={() => {
                    controller.dismissOffer()
                  }}
                >
                  Fechar o link
                </Button>
              </div>
            </div>
          )}
        </div>
        <section aria-labelledby="suppliers-title" className="min-w-0">
          <h2 id="suppliers-title" className="font-display text-2xl leading-tight font-semibold">
            Fornecedores
          </h2>
          <p className="text-muted-foreground">
            Desativar tira o acesso na hora e cancela as reservas futuras da pessoa. O histórico
            fica guardado.
          </p>
          {state.suppliers.length === 0 ? (
            <p className="mt-3">Nenhum fornecedor cadastrado ainda.</p>
          ) : (
            <ul className="mt-3 grid gap-3">
              {state.suppliers.map((supplier) => (
                <SupplierRow
                  key={supplier.id}
                  supplier={supplier}
                  state={state}
                  controller={controller}
                />
              ))}
            </ul>
          )}
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

function NewSupplierForm({
  state,
  controller,
}: {
  state: SuppliersReady
  controller: SuppliersController
}) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (await controller.create({ fullName, email })) {
      setFullName('')
      setEmail('')
    }
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        void submit(event)
      }}
      aria-labelledby="new-supplier-title"
      className="grid gap-3 rounded-xl border border-border bg-card p-4"
    >
      <h2 id="new-supplier-title" className="font-display text-2xl leading-tight font-semibold">
        Novo fornecedor
      </h2>
      <div className="grid gap-1.5">
        <Label htmlFor="new-supplier-name">Nome ou empresa</Label>
        <Input
          id="new-supplier-name"
          value={fullName}
          maxLength={MAX_SUPPLIER_NAME_LENGTH}
          autoComplete="off"
          onChange={(event) => {
            setFullName(event.target.value)
          }}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="new-supplier-email">E-mail</Label>
        <Input
          id="new-supplier-email"
          type="email"
          value={email}
          autoComplete="off"
          onChange={(event) => {
            setEmail(event.target.value)
          }}
        />
      </div>
      {state.formError !== null && (
        <p role="alert" className="text-destructive">
          {state.formError}
        </p>
      )}
      <Button type="submit" disabled={state.busy}>
        Cadastrar fornecedor
      </Button>
    </form>
  )
}

function SupplierRow({
  supplier,
  state,
  controller,
}: {
  supplier: Supplier
  state: SuppliersReady
  controller: SuppliersController
}) {
  const confirming = state.confirmingDeactivate === supplier.id

  return (
    <li className="grid gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-display text-xl leading-tight font-semibold">{supplier.fullName}</h3>
          <p className="text-sm break-all text-muted-foreground">{supplier.email}</p>
          {!supplier.active && (
            <p className="mt-1 text-sm font-semibold text-muted-foreground">
              Desativado: não entra nem reserva
            </p>
          )}
        </div>
        {supplier.active ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={state.busy}
              aria-label={`Gerar novo link de ${supplier.fullName}`}
              onClick={() => {
                void controller.issueLink(supplier.id)
              }}
            >
              Gerar novo link
            </Button>
            <Button
              variant="outline"
              disabled={state.busy}
              aria-label={`Desativar ${supplier.fullName}`}
              onClick={() => {
                controller.askDeactivate(supplier.id)
              }}
            >
              Desativar
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            disabled={state.busy}
            aria-label={`Reativar ${supplier.fullName}`}
            onClick={() => {
              void controller.setActive(supplier.id, true)
            }}
          >
            Reativar
          </Button>
        )}
      </div>
      {confirming && (
        <div
          role="group"
          aria-label={`Confirmar a desativação de ${supplier.fullName}`}
          className="grid gap-2"
        >
          <p>
            Desativar {supplier.fullName}? A pessoa perde o acesso na hora e as reservas futuras
            dela são canceladas.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={state.busy}
              onClick={() => {
                void controller.setActive(supplier.id, false)
              }}
            >
              Sim, desativar
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                controller.keepActive()
              }}
            >
              Voltar
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
