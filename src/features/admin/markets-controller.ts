import { busiestDay, validateMarketInput } from '@/domain/market'
import { addDays, companyDate } from '@/domain/dates'
import { longDate } from '@/domain/format'
import { BOOKING_WINDOW_DAYS, MAX_CAPACITY, MIN_CAPACITY } from '@/domain/booking'
import type { BookingGateway } from '@/lib/supabase/booking-gateway'
import type { Market } from '@/lib/supabase/mappers'
import type { Notice } from '@/features/booking/booking-controller'
import { describeFailure } from '@/features/booking/messages'

export interface MarketsReady {
  status: 'ready'
  /** Todos os mercados, arquivados no fim. */
  markets: Market[]
  /** O mercado que está sendo editado (nome e endereço). */
  editing: string | null
  /** O mercado cujo arquivamento está esperando confirmação. */
  confirmingArchive: string | null
  /** Erro de validação do formulário aberto (novo ou edição). */
  formError: string | null
  busy: boolean
  notice: Notice | null
}

export type MarketsState =
  { status: 'loading' } | { status: 'failed'; message: string } | MarketsReady

export interface MarketsController {
  getState(): MarketsState
  subscribe(listener: () => void): () => void
  start(): Promise<void>
  create(raw: { name: string; address: string; capacity: number }): Promise<boolean>
  startEdit(id: string): void
  cancelEdit(): void
  save(id: string, raw: { name: string; address: string }): Promise<boolean>
  setCapacity(id: string, capacity: number): Promise<void>
  askArchive(id: string): void
  keepActive(): void
  setArchived(id: string, archived: boolean): Promise<void>
  dismissNotice(): void
}

const byName = (a: Market, b: Market) =>
  Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'pt-BR')

export function createMarketsController(deps: {
  gateway: BookingGateway
  now?: () => Date
}): MarketsController {
  const { gateway } = deps
  const now = deps.now ?? (() => new Date())

  let state: MarketsState = { status: 'loading' }
  const listeners = new Set<() => void>()
  let noticeId = 0

  function set(next: MarketsState): void {
    state = next
    for (const listener of [...listeners]) listener()
  }
  function ready(): MarketsReady | null {
    return state.status === 'ready' ? state : null
  }
  function patch(change: Partial<Omit<MarketsReady, 'status'>>): void {
    const current = ready()
    if (current !== null) set({ ...current, ...change })
  }
  function notify(kind: Notice['kind'], text: string): Notice {
    noticeId += 1
    return { id: noticeId, kind, text }
  }
  /** Troca um mercado na lista pelo que o servidor devolveu. */
  function replace(updated: Market): Market[] {
    const current = ready()
    if (current === null) return []
    return current.markets.map((entry) => (entry.id === updated.id ? updated : entry)).sort(byName)
  }

  async function start(): Promise<void> {
    set({ status: 'loading' })
    try {
      const markets = await gateway.listMarkets()
      set({
        status: 'ready',
        markets: [...markets].sort(byName),
        editing: null,
        confirmingArchive: null,
        formError: null,
        busy: false,
        notice: null,
      })
    } catch (error) {
      set({ status: 'failed', message: describeFailure(error) })
    }
  }

  async function create(raw: {
    name: string
    address: string
    capacity: number
  }): Promise<boolean> {
    const current = ready()
    if (current === null || current.busy) return false
    const checked = validateMarketInput(raw)
    if (!checked.ok) {
      patch({ formError: checked.message })
      return false
    }
    patch({ busy: true, formError: null })
    try {
      const created = await gateway.createMarket(checked.value)
      patch({
        busy: false,
        markets: [...(ready()?.markets ?? []), created].sort(byName),
        notice: notify('success', `Mercado ${created.name} cadastrado.`),
      })
      return true
    } catch (error) {
      patch({ busy: false, notice: notify('error', describeFailure(error)) })
      return false
    }
  }

  function startEdit(id: string): void {
    patch({ editing: id, confirmingArchive: null, formError: null })
  }

  function cancelEdit(): void {
    patch({ editing: null, formError: null })
  }

  async function save(id: string, raw: { name: string; address: string }): Promise<boolean> {
    const current = ready()
    const market = current?.markets.find((entry) => entry.id === id)
    if (current === null || current.busy || market === undefined) return false
    const checked = validateMarketInput({ ...raw, capacity: market.capacity })
    if (!checked.ok) {
      patch({ formError: checked.message })
      return false
    }
    patch({ busy: true, formError: null })
    try {
      const updated = await gateway.updateMarket(id, {
        name: checked.value.name,
        address: checked.value.address,
      })
      patch({
        busy: false,
        editing: null,
        markets: replace(updated),
        notice: notify('success', 'Mercado atualizado.'),
      })
      return true
    } catch (error) {
      patch({ busy: false, notice: notify('error', describeFailure(error)) })
      return false
    }
  }

  async function setCapacity(id: string, capacity: number): Promise<void> {
    const current = ready()
    const market = current?.markets.find((entry) => entry.id === id)
    if (current === null || current.busy || market === undefined) return
    if (capacity < MIN_CAPACITY || capacity > MAX_CAPACITY || capacity === market.capacity) return

    patch({ busy: true })
    try {
      const updated = await gateway.updateMarket(id, { capacity })
      let text = `Limite de ${updated.name}: ${capacity} ${capacity === 1 ? 'estande' : 'estandes'} por dia.`
      if (capacity < market.capacity) {
        // Reduzir não cancela nada: avisa se já há dias com mais reservas do que o limite novo.
        // Pelas contagens da disponibilidade (uma por dia), que não esbarram no teto de linhas.
        const today = companyDate(now())
        const result = await gateway.availability(
          id,
          today,
          addDays(today, BOOKING_WINDOW_DAYS + 1),
        )
        const busiest = result.ok ? busiestDay(result.availability.days) : null
        if (busiest !== null && busiest.count > capacity) {
          text += ` ${longDate(busiest.day)} já tem ${busiest.count} reservas: os dias que passam do limite novo continuam como estão, só as reservas novas respeitam.`
        }
      }
      patch({ busy: false, markets: replace(updated), notice: notify('info', text) })
    } catch (error) {
      patch({ busy: false, notice: notify('error', describeFailure(error)) })
    }
  }

  function askArchive(id: string): void {
    patch({ confirmingArchive: id, editing: null })
  }

  function keepActive(): void {
    patch({ confirmingArchive: null })
  }

  async function setArchived(id: string, archived: boolean): Promise<void> {
    const current = ready()
    if (current === null || current.busy) return
    patch({ busy: true })
    try {
      const updated = await gateway.updateMarket(id, { archived })
      patch({
        busy: false,
        confirmingArchive: null,
        markets: replace(updated),
        notice: notify(
          'success',
          archived
            ? `${updated.name} arquivado. Não aceita novas reservas; as que já existem continuam.`
            : `${updated.name} voltou a aceitar reservas.`,
        ),
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
    startEdit,
    cancelEdit,
    save,
    setCapacity,
    askArchive,
    keepActive,
    setArchived,
    dismissNotice,
  }
}
