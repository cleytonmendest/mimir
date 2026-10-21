import { BOOKING_WINDOW_DAYS } from '@/domain/booking'
import { bookableMonths, compareMonths, monthOf, type YearMonth } from '@/domain/calendar'
import { addDays, companyDate } from '@/domain/dates'
import { longDate } from '@/domain/format'
import type { MarketAvailability } from '@/domain/booking'
import type { IsoDate } from '@/domain/types'
import type { BookingGateway } from '@/lib/supabase/booking-gateway'
import type { Market, MyBooking } from '@/lib/supabase/mappers'
import { describeBookingRefusal, describeCancelRefusal, describeFailure } from './messages'

export interface Notice {
  /** Muda a cada aviso: é o que faz um aviso igual ao anterior aparecer de novo. */
  id: number
  kind: 'success' | 'info' | 'error'
  text: string
}

export interface ReadyState {
  status: 'ready'
  /** Só os mercados que aceitam reservas. */
  markets: Market[]
  marketId: string | null
  /** O calendário do mercado escolhido (null enquanto carrega). */
  availability: MarketAvailability | null
  availabilityError: string | null
  month: YearMonth
  selectedDay: IsoDate | null
  /** A pessoa clicou em "Reservar" e falta confirmar. */
  confirming: boolean
  /** A reserva que a pessoa está prestes a cancelar, e em qual lugar da tela perguntou. */
  cancelling: { id: string; where: 'panel' | 'list' } | null
  myBookings: MyBooking[]
  /** Uma ação está no ar: os botões esperam. */
  busy: boolean
  notice: Notice | null
}

export type BookingState =
  { status: 'loading' } | { status: 'failed'; message: string } | ReadyState

export interface BookingController {
  getState(): BookingState
  subscribe(listener: () => void): () => void
  /** Carrega mercados, reservas e o calendário do primeiro mercado. */
  start(): Promise<void>
  /** Recarrega o calendário e as reservas (ao voltar para a aba, depois de uma ação). */
  refresh(): Promise<void>
  selectMarket(marketId: string): Promise<void>
  changeMonth(month: YearMonth): void
  selectDay(day: IsoDate): void
  startBooking(): void
  backFromConfirm(): void
  confirmBooking(): Promise<void>
  askCancel(id: string, where: 'panel' | 'list'): void
  keepBooking(): void
  confirmCancel(): Promise<void>
  /** Leva o calendário à reserva escolhida em "Minhas reservas". */
  goToBooking(id: string): Promise<void>
  dismissNotice(): void
}

export interface BookingControllerDeps {
  gateway: BookingGateway
  now?: () => Date
}

export function createBookingController(deps: BookingControllerDeps): BookingController {
  const { gateway } = deps
  const now = deps.now ?? (() => new Date())

  let state: BookingState = { status: 'loading' }
  const listeners = new Set<() => void>()
  let noticeId = 0
  /** Resposta de calendário que chegou depois de a pessoa trocar de mercado não vale. */
  let availabilityRequest = 0

  function set(next: BookingState): void {
    state = next
    for (const listener of [...listeners]) listener()
  }

  function ready(): ReadyState | null {
    return state.status === 'ready' ? state : null
  }

  function patch(change: Partial<Omit<ReadyState, 'status'>>): void {
    const current = ready()
    if (current !== null) set({ ...current, ...change })
  }

  function notify(kind: Notice['kind'], text: string): Notice {
    noticeId += 1
    return { id: noticeId, kind, text }
  }

  const clientToday = () => companyDate(now())

  async function loadAvailability(): Promise<void> {
    const current = ready()
    if (current === null || current.marketId === null) return
    const marketId = current.marketId
    availabilityRequest += 1
    const request = availabilityRequest
    const today = clientToday()
    try {
      // De hoje a um dia depois da janela: cobre a diferença entre o relógio daqui e o do servidor.
      const result = await gateway.availability(
        marketId,
        today,
        addDays(today, BOOKING_WINDOW_DAYS + 1),
      )
      if (request !== availabilityRequest) return
      if (result.ok) patch({ availability: result.availability, availabilityError: null })
      else
        patch({ availability: null, availabilityError: 'Não foi possível mostrar este mercado.' })
    } catch (error) {
      if (request !== availabilityRequest) return
      patch({ availability: null, availabilityError: describeFailure(error) })
    }
  }

  async function loadBookings(): Promise<void> {
    try {
      patch({ myBookings: await gateway.myBookings(clientToday()) })
    } catch (error) {
      patch({ notice: notify('error', describeFailure(error)) })
    }
  }

  async function start(): Promise<void> {
    set({ status: 'loading' })
    try {
      const today = clientToday()
      const [markets, myBookings] = await Promise.all([
        gateway.listMarkets(),
        gateway.myBookings(today),
      ])
      const open = markets.filter((entry) => !entry.archived)
      set({
        status: 'ready',
        markets: open,
        marketId: open[0]?.id ?? null,
        availability: null,
        availabilityError: null,
        month: monthOf(addDays(today, 1)),
        selectedDay: null,
        confirming: false,
        cancelling: null,
        myBookings,
        busy: false,
        notice: null,
      })
      await loadAvailability()
    } catch (error) {
      set({ status: 'failed', message: describeFailure(error) })
    }
  }

  async function refresh(): Promise<void> {
    await Promise.all([loadAvailability(), loadBookings()])
  }

  /** Mexer na seleção cancela qualquer pergunta de confirmação que estivesse aberta. */
  const closeQuestions = { confirming: false, cancelling: null } as const

  async function selectMarket(marketId: string): Promise<void> {
    const current = ready()
    if (current === null || current.marketId === marketId) return
    patch({
      marketId,
      availability: null,
      availabilityError: null,
      selectedDay: null,
      ...closeQuestions,
    })
    await loadAvailability()
  }

  function changeMonth(month: YearMonth): void {
    const current = ready()
    if (current === null) return
    const today = current.availability?.today ?? clientToday()
    const { first, last } = bookableMonths(today, BOOKING_WINDOW_DAYS)
    if (compareMonths(month, first) < 0 || compareMonths(month, last) > 0) return
    patch({ month })
  }

  function selectDay(day: IsoDate): void {
    patch({ selectedDay: day, ...closeQuestions })
  }

  function startBooking(): void {
    const current = ready()
    if (current === null || current.selectedDay === null || current.busy) return
    patch({ confirming: true })
  }

  function backFromConfirm(): void {
    patch({ confirming: false })
  }

  async function confirmBooking(): Promise<void> {
    const current = ready()
    if (current === null || current.busy) return
    const { marketId, selectedDay } = current
    if (marketId === null || selectedDay === null) return
    const marketName = current.markets.find((entry) => entry.id === marketId)?.name ?? ''

    patch({ busy: true })
    try {
      const result = await gateway.book(marketId, selectedDay)
      const notice = result.ok
        ? notify(
            'success',
            result.alreadyBooked
              ? 'Você já tinha reservado este dia.'
              : `Reserva confirmada: ${marketName}, ${longDate(selectedDay).toLowerCase()}. Ela aparece em Minhas reservas.`,
          )
        : notify('error', describeBookingRefusal(result.code))
      patch({ busy: false, confirming: false, notice })
      // Com recusa ou sem, o calendário e as reservas passam a mostrar o que o servidor decidiu.
      await refresh()
    } catch (error) {
      patch({ busy: false, confirming: false, notice: notify('error', describeFailure(error)) })
    }
  }

  function askCancel(id: string, where: 'panel' | 'list'): void {
    patch({ cancelling: { id, where } })
  }

  function keepBooking(): void {
    patch({ cancelling: null })
  }

  async function confirmCancel(): Promise<void> {
    const current = ready()
    if (current === null || current.busy || current.cancelling === null) return
    const { id } = current.cancelling

    patch({ busy: true })
    try {
      const result = await gateway.cancel(id)
      const notice = result.ok
        ? notify('success', 'Reserva cancelada. A vaga voltou a ficar livre.')
        : notify('error', describeCancelRefusal(result.code))
      patch({ busy: false, cancelling: null, notice })
      await refresh()
    } catch (error) {
      patch({ busy: false, cancelling: null, notice: notify('error', describeFailure(error)) })
    }
  }

  async function goToBooking(id: string): Promise<void> {
    const current = ready()
    const booking = current?.myBookings.find((entry) => entry.id === id)
    if (current === null || booking === undefined) return
    const sameMarket = current.marketId === booking.marketId
    patch({
      marketId: booking.marketId,
      month: monthOf(booking.day),
      selectedDay: booking.day,
      ...closeQuestions,
      ...(sameMarket ? {} : { availability: null, availabilityError: null }),
    })
    if (!sameMarket) await loadAvailability()
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
    startBooking,
    backFromConfirm,
    confirmBooking,
    askCancel,
    keepBooking,
    confirmCancel,
    goToBooking,
    dismissNotice,
  }
}
