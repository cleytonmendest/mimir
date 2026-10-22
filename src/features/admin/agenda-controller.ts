import { BOOKING_WINDOW_DAYS, type MarketAvailability } from '@/domain/booking'
import { bookableMonths, compareMonths, monthOf, type YearMonth } from '@/domain/calendar'
import { addDays, companyDate } from '@/domain/dates'
import { plural } from '@/domain/format'
import type { IsoDate } from '@/domain/types'
import type { BookingGateway } from '@/lib/supabase/booking-gateway'
import type { AdminBooking, ClosedDay, Market } from '@/lib/supabase/mappers'
import type { Notice } from '@/features/booking/booking-controller'
import { describeCancelRefusal, describeFailure } from '@/features/booking/messages'

export interface AgendaReady {
  status: 'ready'
  /** Só os mercados ativos: o arquivado sai da agenda. */
  markets: Market[]
  marketId: string | null
  availability: MarketAvailability | null
  availabilityError: string | null
  /** As datas fechadas do mercado escolhido, com o motivo. */
  closedDays: ClosedDay[]
  /** As próximas reservas de todos os mercados, com o nome do fornecedor (só as primeiras). */
  upcoming: AdminBooking[]
  /**
   * Quem reservou o dia escolhido, no mercado escolhido. null = ainda carregando (ou nenhum dia
   * escolhido). Só se pede esse recorte: baixar tudo esbarraria no teto de 1.000 linhas do servidor.
   */
  dayBookings: AdminBooking[] | null
  dayError: string | null
  month: YearMonth
  selectedDay: IsoDate | null
  /** O que o administrador digitou como motivo ao fechar o dia. */
  closeReason: string
  /** A reserva que ele está prestes a cancelar, e o motivo digitado. */
  cancelling: { id: string; reason: string } | null
  busy: boolean
  notice: Notice | null
}

export type AgendaState =
  { status: 'loading' } | { status: 'failed'; message: string } | AgendaReady

export interface AgendaController {
  getState(): AgendaState
  subscribe(listener: () => void): () => void
  start(): Promise<void>
  refresh(): Promise<void>
  selectMarket(marketId: string): Promise<void>
  changeMonth(month: YearMonth): void
  selectDay(day: IsoDate): Promise<void>
  setCloseReason(text: string): void
  /** Fecha o dia escolhido para novas reservas, ou o libera se já estiver fechado. */
  toggleClosed(): Promise<void>
  askCancel(id: string): void
  setCancelReason(text: string): void
  keepBooking(): void
  confirmCancel(): Promise<void>
  dismissNotice(): void
}

/** Quantas reservas "próximas" aparecem na lista. */
export const UPCOMING_COUNT = 8

export function createAgendaController(deps: {
  gateway: BookingGateway
  now?: () => Date
}): AgendaController {
  const { gateway } = deps
  const now = deps.now ?? (() => new Date())

  let state: AgendaState = { status: 'loading' }
  const listeners = new Set<() => void>()
  let noticeId = 0
  let marketRequest = 0
  let dayRequest = 0

  function set(next: AgendaState): void {
    state = next
    for (const listener of [...listeners]) listener()
  }

  function ready(): AgendaReady | null {
    return state.status === 'ready' ? state : null
  }

  function patch(change: Partial<Omit<AgendaReady, 'status'>>): void {
    const current = ready()
    if (current !== null) set({ ...current, ...change })
  }

  function notify(kind: Notice['kind'], text: string): Notice {
    noticeId += 1
    return { id: noticeId, kind, text }
  }

  const today = () => companyDate(now())
  const horizon = () => addDays(today(), BOOKING_WINDOW_DAYS + 1)

  /** O calendário e as datas fechadas do mercado escolhido. */
  async function loadMarket(): Promise<void> {
    const current = ready()
    if (current === null || current.marketId === null) return
    const marketId = current.marketId
    marketRequest += 1
    const request = marketRequest
    try {
      const [availability, closedDays] = await Promise.all([
        gateway.availability(marketId, today(), horizon()),
        gateway.closedDays(marketId, today(), horizon()),
      ])
      if (request !== marketRequest) return
      if (availability.ok) {
        patch({ availability: availability.availability, closedDays, availabilityError: null })
      } else {
        patch({
          availability: null,
          closedDays: [],
          availabilityError: 'Não foi possível mostrar este mercado.',
        })
      }
    } catch (error) {
      if (request !== marketRequest) return
      patch({ availability: null, closedDays: [], availabilityError: describeFailure(error) })
    }
  }

  async function loadUpcoming(): Promise<void> {
    try {
      patch({ upcoming: await gateway.adminBookings({ from: today(), limit: UPCOMING_COUNT }) })
    } catch (error) {
      patch({ notice: notify('error', describeFailure(error)) })
    }
  }

  /** Quem reservou o dia escolhido no mercado escolhido. */
  async function loadDay(): Promise<void> {
    const current = ready()
    if (current === null) return
    const { marketId, selectedDay } = current
    dayRequest += 1
    const request = dayRequest
    if (marketId === null || selectedDay === null) {
      patch({ dayBookings: null, dayError: null })
      return
    }
    patch({ dayBookings: null, dayError: null })
    try {
      const rows = await gateway.adminBookings({ from: selectedDay, to: selectedDay, marketId })
      if (request === dayRequest) patch({ dayBookings: rows })
    } catch (error) {
      if (request === dayRequest) patch({ dayError: describeFailure(error) })
    }
  }

  async function start(): Promise<void> {
    set({ status: 'loading' })
    try {
      const [markets, upcoming] = await Promise.all([
        gateway.listMarkets(),
        gateway.adminBookings({ from: today(), limit: UPCOMING_COUNT }),
      ])
      const open = markets.filter((entry) => !entry.archived)
      set({
        status: 'ready',
        markets: open,
        marketId: open[0]?.id ?? null,
        availability: null,
        availabilityError: null,
        closedDays: [],
        upcoming,
        dayBookings: null,
        dayError: null,
        month: monthOf(addDays(today(), 1)),
        selectedDay: null,
        closeReason: '',
        cancelling: null,
        busy: false,
        notice: null,
      })
      await loadMarket()
    } catch (error) {
      set({ status: 'failed', message: describeFailure(error) })
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([loadMarket(), loadUpcoming(), loadDay()])
  }

  async function selectMarket(marketId: string): Promise<void> {
    const current = ready()
    if (current === null || current.marketId === marketId) return
    patch({
      marketId,
      availability: null,
      availabilityError: null,
      closedDays: [],
      selectedDay: null,
      dayBookings: null,
      dayError: null,
      closeReason: '',
      cancelling: null,
    })
    dayRequest += 1
    await loadMarket()
  }

  function changeMonth(month: YearMonth): void {
    const current = ready()
    if (current === null) return
    const { first, last } = bookableMonths(
      current.availability?.today ?? today(),
      BOOKING_WINDOW_DAYS,
    )
    if (compareMonths(month, first) < 0 || compareMonths(month, last) > 0) return
    patch({ month })
  }

  async function selectDay(day: IsoDate): Promise<void> {
    patch({ selectedDay: day, closeReason: '', cancelling: null })
    await loadDay()
  }

  function setCloseReason(text: string): void {
    patch({ closeReason: text })
  }

  async function toggleClosed(): Promise<void> {
    const current = ready()
    if (current === null || current.busy) return
    const { marketId, selectedDay, availability } = current
    if (marketId === null || selectedDay === null || availability === null) return
    const entry = availability.days.find((candidate) => candidate.day === selectedDay)
    const closed = entry?.closed === true

    patch({ busy: true })
    try {
      let text: string
      if (closed) {
        await gateway.openDay(marketId, selectedDay)
        text = 'Dia liberado para reservas.'
      } else {
        await gateway.closeDay(marketId, selectedDay, current.closeReason.trim() || undefined)
        const kept = entry?.booked ?? 0
        text =
          'Dia fechado para novas reservas.' +
          (kept > 0
            ? ` ${plural(kept, 'reserva já feita continua', 'reservas já feitas continuam')} valendo.`
            : '')
      }
      patch({ busy: false, closeReason: '', notice: notify('success', text) })
      await loadMarket()
    } catch (error) {
      patch({ busy: false, notice: notify('error', describeFailure(error)) })
    }
  }

  function askCancel(id: string): void {
    patch({ cancelling: { id, reason: '' } })
  }

  function setCancelReason(text: string): void {
    const current = ready()
    if (current?.cancelling == null) return
    patch({ cancelling: { ...current.cancelling, reason: text } })
  }

  function keepBooking(): void {
    patch({ cancelling: null })
  }

  async function confirmCancel(): Promise<void> {
    const current = ready()
    if (current === null || current.busy || current.cancelling === null) return
    const { id, reason } = current.cancelling

    patch({ busy: true })
    try {
      const result = await gateway.cancel(id, reason.trim() || undefined)
      const notice = result.ok
        ? notify('success', 'Reserva cancelada. O sistema não avisa o fornecedor: combine com ele.')
        : notify('error', describeCancelRefusal(result.code))
      patch({ busy: false, cancelling: null, notice })
      await refresh()
    } catch (error) {
      patch({ busy: false, cancelling: null, notice: notify('error', describeFailure(error)) })
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
    refresh,
    selectMarket,
    changeMonth,
    selectDay,
    setCloseReason,
    toggleClosed,
    askCancel,
    setCancelReason,
    keepBooking,
    confirmCancel,
    dismissNotice,
  }
}
