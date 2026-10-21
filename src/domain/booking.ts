import { addDays, daysBetween } from './dates'
import { can } from './permissions'
import type { Actor, IsoDate } from './types'

/**
 * Reserva de estande: o que o servidor decide (book_slot_v1) e o que a tela precisa para desenhar.
 * As regras moram em dois lugares, TypeScript e SQL. O que impede que se separem são os casos
 * compartilhados (fixtures/booking.cases.json), cumpridos aqui no Vitest e no banco pelo pgTAP gerado.
 */

/** Quantos dias à frente dá para reservar, a partir de amanhã. Espelha public.booking_window_days(). */
export const BOOKING_WINDOW_DAYS = 60

export const MIN_CAPACITY = 1
export const MAX_CAPACITY = 20
export const DEFAULT_CAPACITY = 3

/**
 * Por que uma reserva foi recusada. É o vocabulário do servidor: o app lê um código desconhecido
 * como UNRECOGNIZED (ver booking-wire), sem quebrar.
 */
export const BOOKING_REFUSALS = [
  'FULL',
  'CLOSED',
  'OUT_OF_WINDOW',
  'MARKET_INACTIVE',
  'FORBIDDEN',
] as const
export type BookingRefusal = (typeof BOOKING_REFUSALS)[number]

export const CANCEL_REFUSALS = ['NOT_FOUND', 'PAST', 'FORBIDDEN'] as const
export type CancelRefusal = (typeof CANCEL_REFUSALS)[number]

/** O que se sabe do par (mercado, dia) na hora de reservar. */
export interface SlotState {
  marketArchived: boolean
  closed: boolean
  capacity: number
  /** Reservas ativas de todos os fornecedores. */
  booked: number
  /** Quem reserva já tem uma reserva ativa nesse par. */
  mine: boolean
}

export type BookingDecision =
  { ok: true; alreadyBooked: boolean } | { ok: false; code: BookingRefusal }

/** Reservável: depois de hoje e até `windowDays` à frente. */
export function isBookableDay(
  today: IsoDate,
  day: IsoDate,
  windowDays: number = BOOKING_WINDOW_DAYS,
): boolean {
  const ahead = daysBetween(today, day)
  return ahead >= 1 && ahead <= windowDays
}

/** O primeiro e o último dia em que ainda dá para reservar. */
export function bookableRange(
  today: IsoDate,
  windowDays: number = BOOKING_WINDOW_DAYS,
): { from: IsoDate; to: IsoDate } {
  return { from: addDays(today, 1), to: addDays(today, windowDays) }
}

/**
 * A decisão do servidor, na ordem em que ele confere: quem pode, mercado, janela, dia fechado,
 * reserva que já é sua (repetir é seguro, devolve sucesso) e, por último, vaga.
 */
export function evaluateBooking(input: {
  actor: Actor
  today: IsoDate
  day: IsoDate
  slot: SlotState
  windowDays?: number
}): BookingDecision {
  const { actor, today, day, slot } = input
  if (!can(actor, 'book')) return { ok: false, code: 'FORBIDDEN' }
  if (slot.marketArchived) return { ok: false, code: 'MARKET_INACTIVE' }
  if (!isBookableDay(today, day, input.windowDays)) return { ok: false, code: 'OUT_OF_WINDOW' }
  if (slot.closed) return { ok: false, code: 'CLOSED' }
  if (slot.mine) return { ok: true, alreadyBooked: true }
  if (slot.booked >= slot.capacity) return { ok: false, code: 'FULL' }
  return { ok: true, alreadyBooked: false }
}

export type CancelDecision =
  { ok: true; alreadyCancelled: boolean } | { ok: false; code: CancelRefusal }

/**
 * Cancelar: o fornecedor só a própria reserva (a dos outros é "não encontrada", para não revelar
 * que existe); o administrador qualquer uma. Cancelar de novo é sucesso. Reserva de dia que já
 * passou é histórico e não se cancela; a do próprio dia ainda se cancela.
 */
export function evaluateCancel(input: {
  actor: Actor
  today: IsoDate
  booking: { supplierId: string; day: IsoDate; cancelled: boolean }
}): CancelDecision {
  const { actor, today, booking } = input
  if (!can(actor, 'cancelBooking', { supplierId: booking.supplierId })) {
    return { ok: false, code: 'NOT_FOUND' }
  }
  if (booking.cancelled) return { ok: true, alreadyCancelled: true }
  if (booking.day < today) return { ok: false, code: 'PAST' }
  return { ok: true, alreadyCancelled: false }
}

/** Como o calendário pinta um dia. */
export type DayStatus = 'past' | 'far' | 'closed' | 'full' | 'partial' | 'free'

export function freeSlots(capacity: number, booked: number): number {
  return Math.max(0, capacity - booked)
}

export function dayStatus(input: {
  today: IsoDate
  day: IsoDate
  closed: boolean
  booked: number
  capacity: number
  windowDays?: number
}): DayStatus {
  const windowDays = input.windowDays ?? BOOKING_WINDOW_DAYS
  const ahead = daysBetween(input.today, input.day)
  if (ahead < 1) return 'past'
  if (ahead > windowDays) return 'far'
  if (input.closed) return 'closed'
  if (input.booked >= input.capacity) return 'full'
  return input.booked > 0 ? 'partial' : 'free'
}

/** Um dia do calendário de um mercado, como o servidor informa (só contagens, nunca nomes). */
export interface DayAvailability {
  day: IsoDate
  booked: number
  closed: boolean
  /** O fornecedor logado tem reserva ativa nesse dia. */
  mine: boolean
}

export interface MarketAvailability {
  /** O "hoje" do servidor (fuso da empresa): a tela desenha a janela a partir dele. */
  today: IsoDate
  capacity: number
  days: DayAvailability[]
}
