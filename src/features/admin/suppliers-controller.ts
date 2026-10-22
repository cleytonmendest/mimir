import { validateSupplierInput } from '@/domain/access'
import type { Notice } from '@/features/booking/booking-controller'
import { describeFailure } from '@/features/booking/messages'
import { activationLink } from '@/features/access/routes'
import type { AccessGateway } from '@/lib/supabase/access-gateway'
import type { Supplier } from '@/lib/supabase/mappers'

/** O link de ativação que o administrador acabou de gerar, para entregar ao fornecedor. */
export interface ActivationOffer {
  supplierName: string
  url: string
  /** true = acabou de ser cadastrado; false = novo link para quem perdeu o acesso. */
  firstAccess: boolean
}

export interface SuppliersReady {
  status: 'ready'
  /** Ativos primeiro, depois os desativados; cada grupo por nome. */
  suppliers: Supplier[]
  offer: ActivationOffer | null
  /** O fornecedor cuja desativação está esperando confirmação. */
  confirmingDeactivate: string | null
  formError: string | null
  busy: boolean
  notice: Notice | null
}

export type SuppliersState =
  { status: 'loading' } | { status: 'failed'; message: string } | SuppliersReady

export interface SuppliersController {
  getState(): SuppliersState
  subscribe(listener: () => void): () => void
  start(): Promise<void>
  create(raw: { fullName: string; email: string }): Promise<boolean>
  issueLink(supplierId: string): Promise<void>
  dismissOffer(): void
  askDeactivate(supplierId: string): void
  keepActive(): void
  setActive(supplierId: string, active: boolean): Promise<void>
  dismissNotice(): void
}

const order = (a: Supplier, b: Supplier) =>
  Number(!a.active) - Number(!b.active) || a.fullName.localeCompare(b.fullName, 'pt-BR')

function reservations(count: number): string {
  return count === 1 ? '1 reserva futura cancelada' : `${count} reservas futuras canceladas`
}

export function createSuppliersController(deps: {
  gateway: AccessGateway
  /** De onde o app é servido (https://…): o link de ativação aponta para cá. */
  origin: string
}): SuppliersController {
  const { gateway, origin } = deps

  let state: SuppliersState = { status: 'loading' }
  const listeners = new Set<() => void>()
  let noticeId = 0

  function set(next: SuppliersState): void {
    state = next
    for (const listener of [...listeners]) listener()
  }
  function ready(): SuppliersReady | null {
    return state.status === 'ready' ? state : null
  }
  function patch(change: Partial<Omit<SuppliersReady, 'status'>>): void {
    const current = ready()
    if (current !== null) set({ ...current, ...change })
  }
  function notify(kind: Notice['kind'], text: string): Notice {
    noticeId += 1
    return { id: noticeId, kind, text }
  }

  async function start(): Promise<void> {
    set({ status: 'loading' })
    try {
      const suppliers = await gateway.listSuppliers()
      set({
        status: 'ready',
        suppliers: [...suppliers].sort(order),
        offer: null,
        confirmingDeactivate: null,
        formError: null,
        busy: false,
        notice: null,
      })
    } catch (error) {
      set({ status: 'failed', message: describeFailure(error) })
    }
  }

  async function create(raw: { fullName: string; email: string }): Promise<boolean> {
    const current = ready()
    if (current === null || current.busy) return false
    const checked = validateSupplierInput(raw)
    if (!checked.ok) {
      patch({ formError: checked.message })
      return false
    }
    patch({ busy: true, formError: null })
    try {
      const result = await gateway.createSupplier(checked.value)
      if (!result.ok) {
        patch({
          busy: false,
          formError:
            result.code === 'EMAIL_EXISTS'
              ? 'Já existe uma conta com esse e-mail. Procure o fornecedor na lista.'
              : result.message,
        })
        return false
      }
      patch({
        busy: false,
        suppliers: [...(ready()?.suppliers ?? []), result.supplier].sort(order),
        offer: {
          supplierName: result.supplier.fullName,
          url: activationLink(origin, result.token),
          firstAccess: true,
        },
        notice: notify(
          'success',
          `${result.supplier.fullName} cadastrado. Envie o link para ele escolher a senha.`,
        ),
      })
      return true
    } catch (error) {
      patch({ busy: false, notice: notify('error', describeFailure(error)) })
      return false
    }
  }

  async function issueLink(supplierId: string): Promise<void> {
    const current = ready()
    const supplier = current?.suppliers.find((entry) => entry.id === supplierId)
    if (current === null || current.busy || supplier === undefined) return
    patch({ busy: true })
    try {
      const result = await gateway.supplierLink(supplierId)
      if (!result.ok) {
        patch({
          busy: false,
          notice: notify(
            'error',
            result.code === 'DEACTIVATED'
              ? `${supplier.fullName} está desativado. Reative antes de gerar um link.`
              : 'Não encontramos esse fornecedor. Atualize a lista.',
          ),
        })
        return
      }
      patch({
        busy: false,
        offer: {
          supplierName: supplier.fullName,
          url: activationLink(origin, result.token),
          firstAccess: false,
        },
      })
    } catch (error) {
      patch({ busy: false, notice: notify('error', describeFailure(error)) })
    }
  }

  function dismissOffer(): void {
    patch({ offer: null })
  }

  function askDeactivate(supplierId: string): void {
    patch({ confirmingDeactivate: supplierId })
  }

  function keepActive(): void {
    patch({ confirmingDeactivate: null })
  }

  async function setActive(supplierId: string, active: boolean): Promise<void> {
    const current = ready()
    const supplier = current?.suppliers.find((entry) => entry.id === supplierId)
    if (current === null || current.busy || supplier === undefined) return
    patch({ busy: true })
    try {
      const result = await gateway.setSupplierActive(supplierId, active)
      if (!result.ok) {
        patch({
          busy: false,
          confirmingDeactivate: null,
          notice: notify('error', 'Não foi possível mudar esse fornecedor. Atualize a lista.'),
        })
        return
      }
      const latest = ready()
      const text = active
        ? `${supplier.fullName} foi reativado e já pode entrar.`
        : `${supplier.fullName} foi desativado.${result.cancelled > 0 ? ` ${reservations(result.cancelled)}.` : ''}`
      patch({
        busy: false,
        confirmingDeactivate: null,
        suppliers: (latest?.suppliers ?? [])
          .map((entry) => (entry.id === supplierId ? { ...entry, active } : entry))
          .sort(order),
        // Um link de ativação de quem acabou de ser desativado não vale mais nada.
        offer:
          !active && latest?.offer?.supplierName === supplier.fullName
            ? null
            : (latest?.offer ?? null),
        notice: notify('success', text),
      })
    } catch (error) {
      patch({ busy: false, notice: notify('error', describeFailure(error)) })
    }
  }

  function dismissNotice(): void {
    patch({ notice: null })
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    start,
    create,
    issueLink,
    dismissOffer,
    askDeactivate,
    keepActive,
    setActive,
    dismissNotice,
  }
}
