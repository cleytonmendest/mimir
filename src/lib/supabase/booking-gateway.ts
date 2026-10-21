import type { IsoDate } from '@/domain/types'
import {
  parseAvailability,
  parseBookResult,
  parseCancelResult,
  type AvailabilityResult,
  type BookResult,
  type CancelResult,
} from './booking-wire'
import { getSupabase, type AppSupabaseClient } from './client'
import { RequestFailure } from './errors'
import {
  adminBookingFromRow,
  marketFromRow,
  myBookingFromRow,
  type AdminBooking,
  type ClosedDay,
  type Market,
  type MarketInput,
  type MyBooking,
} from './mappers'

/**
 * O que as telas precisam de dados de reserva, sem tipo do SDK. Quem decide é o servidor (RLS e as
 * funções book_slot_v1, cancel_booking_v1 e market_availability_v1); aqui só se pede, valida e
 * converte. Recusa de negócio ("lotado", "dia fechado") volta como resultado; falha de rede,
 * sessão ou servidor vira RequestFailure.
 */
export interface BookingGateway {
  listMarkets(): Promise<Market[]>
  availability(marketId: string, from: IsoDate, to: IsoDate): Promise<AvailabilityResult>
  book(marketId: string, day: IsoDate): Promise<BookResult>
  cancel(bookingId: string, reason?: string): Promise<CancelResult>
  /** As reservas ativas do fornecedor logado de `from` em diante. */
  myBookings(from: IsoDate): Promise<MyBooking[]>

  /** Só o administrador. */
  adminBookings(filter: { from: IsoDate; to?: IsoDate; marketId?: string }): Promise<AdminBooking[]>
  createMarket(input: MarketInput): Promise<Market>
  updateMarket(id: string, patch: Partial<MarketInput> & { archived?: boolean }): Promise<Market>
  closedDays(marketId: string, from: IsoDate, to: IsoDate): Promise<ClosedDay[]>
  closeDay(marketId: string, day: IsoDate, reason?: string): Promise<void>
  openDay(marketId: string, day: IsoDate): Promise<void>
}

interface Failed {
  message: string
  code?: string | undefined
}

/** Classifica o erro do PostgREST (e do fetch): rede, sessão ou servidor. */
export function toFailure(error: Failed, status: number): RequestFailure {
  const code = error.code ?? ''
  if (status === 0) return new RequestFailure('NETWORK', 'Sem conexão com o servidor', { cause: error })
  if (status === 401 || status === 403 || code.startsWith('PGRST30')) {
    return new RequestFailure('AUTH', 'A sessão não vale mais, ou você não pode fazer isso', {
      cause: error,
    })
  }
  return new RequestFailure('SERVER', `O servidor não conseguiu atender: ${error.message}`, {
    cause: error,
  })
}

const UNIQUE_VIOLATION = '23505'

export function createBookingGateway(
  getClient: () => AppSupabaseClient = getSupabase,
): BookingGateway {
  /** Desembrulha { data, error, status } do SDK. */
  function unwrap<T>(result: { data: T; error: Failed | null; status: number }): NonNullable<T> {
    if (result.error !== null) throw toFailure(result.error, result.status)
    if (result.data === null || result.data === undefined) {
      throw new RequestFailure('INVALID_RESPONSE', 'O servidor não respondeu')
    }
    return result.data
  }

  return {
    async listMarkets() {
      const rows = unwrap(await getClient().from('markets').select('*').order('name'))
      return rows.map(marketFromRow)
    },

    async availability(marketId, from, to) {
      const data = unwrap(
        await getClient().rpc('market_availability_v1', {
          p_market: marketId,
          p_from: from,
          p_to: to,
        }),
      )
      return parseAvailability(data)
    },

    async book(marketId, day) {
      const data = unwrap(
        await getClient().rpc('book_slot_v1', { p_market: marketId, p_day: day }),
      )
      return parseBookResult(data)
    },

    async cancel(bookingId, reason) {
      const data = unwrap(
        await getClient().rpc('cancel_booking_v1', {
          p_booking: bookingId,
          ...(reason === undefined ? {} : { p_reason: reason }),
        }),
      )
      return parseCancelResult(data)
    },

    async myBookings(from) {
      const rows = unwrap(
        await getClient()
          .from('bookings')
          .select('id, market_id, day, markets(name)')
          .is('cancelled_at', null)
          .gte('day', from)
          .order('day'),
      )
      return rows.map(myBookingFromRow)
    },

    async adminBookings({ from, to, marketId }) {
      let query = getClient()
        .from('bookings')
        .select(
          'id, market_id, day, supplier_id, markets(name), profiles!bookings_supplier_id_fkey(full_name)',
        )
        .is('cancelled_at', null)
        .gte('day', from)
      if (to !== undefined) query = query.lte('day', to)
      if (marketId !== undefined) query = query.eq('market_id', marketId)
      const rows = unwrap(await query.order('day').order('created_at'))
      return rows.map(adminBookingFromRow)
    },

    async createMarket(input) {
      const row = unwrap(
        await getClient()
          .from('markets')
          .insert({ name: input.name, address: input.address, capacity: input.capacity })
          .select('*')
          .single(),
      )
      return marketFromRow(row)
    },

    async updateMarket(id, patch) {
      const change: {
        name?: string
        address?: string | null
        capacity?: number
        archived_at?: string | null
      } = {}
      if (patch.name !== undefined) change.name = patch.name
      if (patch.address !== undefined) change.address = patch.address
      if (patch.capacity !== undefined) change.capacity = patch.capacity
      if (patch.archived !== undefined) {
        change.archived_at = patch.archived ? new Date().toISOString() : null
      }
      const row = unwrap(
        await getClient().from('markets').update(change).eq('id', id).select('*').single(),
      )
      return marketFromRow(row)
    },

    async closedDays(marketId, from, to) {
      const rows = unwrap(
        await getClient()
          .from('closed_days')
          .select('day, reason')
          .eq('market_id', marketId)
          .gte('day', from)
          .lte('day', to)
          .order('day'),
      )
      return rows.map((row) => ({ day: row.day, reason: row.reason }))
    },

    async closeDay(marketId, day, reason) {
      const { error, status } = await getClient()
        .from('closed_days')
        .insert({ market_id: marketId, day, reason: reason ?? null })
      // Fechar um dia que já está fechado é sucesso: o resultado é o mesmo.
      if (error !== null && error.code !== UNIQUE_VIOLATION) throw toFailure(error, status)
    },

    async openDay(marketId, day) {
      const { error, status } = await getClient()
        .from('closed_days')
        .delete()
        .eq('market_id', marketId)
        .eq('day', day)
      if (error !== null) throw toFailure(error, status)
    },
  }
}
