import {
  BOOKING_REFUSALS,
  CANCEL_REFUSALS,
  type BookingRefusal,
  type CancelRefusal,
  type DayAvailability,
  type MarketAvailability,
} from '@/domain/booking'
import type { IsoDate } from '@/domain/types'
import { RequestFailure } from './errors'

/**
 * O que as funções de reserva do banco devolvem (JSON), validado antes de chegar à tela. Um código
 * de recusa que este app não conhece vira UNRECOGNIZED, e não quebra: um servidor mais novo pode
 * ter regras novas. O que não tem a forma esperada é INVALID_RESPONSE.
 */

export type BookResult =
  | { ok: true; bookingId: string; alreadyBooked: boolean; booked: number; capacity: number }
  | { ok: false; code: BookingRefusal | 'UNRECOGNIZED' }

export type CancelResult =
  { ok: true; alreadyCancelled: boolean } | { ok: false; code: CancelRefusal | 'UNRECOGNIZED' }

export const AVAILABILITY_REFUSALS = ['INVALID_RANGE', 'MARKET_NOT_FOUND', 'FORBIDDEN'] as const
export type AvailabilityRefusal = (typeof AVAILABILITY_REFUSALS)[number]

export type AvailabilityResult =
  | { ok: true; availability: MarketAvailability; archived: boolean }
  | { ok: false; code: AvailabilityRefusal | 'UNRECOGNIZED' }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function invalid(what: string): RequestFailure {
  return new RequestFailure('INVALID_RESPONSE', `Resposta inesperada do servidor: ${what}`)
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(what)
  return value as Record<string, unknown>
}

function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw invalid(what)
  return value
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw invalid(what)
  return value
}

function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalid(what)
  return value
}

function date(value: unknown, what: string): IsoDate {
  const parsed = text(value, what)
  if (!ISO_DATE.test(parsed)) throw invalid(what)
  return parsed
}

function refusal<T extends string>(
  body: Record<string, unknown>,
  known: readonly T[],
): { ok: false; code: T | 'UNRECOGNIZED' } {
  const code = text(body['code'], 'code')
  const match = known.find((candidate) => candidate === code)
  return { ok: false, code: match ?? 'UNRECOGNIZED' }
}

export function parseBookResult(data: unknown): BookResult {
  const body = record(data, 'book_slot_v1')
  if (!bool(body['ok'], 'ok')) return refusal(body, BOOKING_REFUSALS)
  return {
    ok: true,
    bookingId: text(body['booking_id'], 'booking_id'),
    alreadyBooked: bool(body['already_booked'], 'already_booked'),
    booked: count(body['booked'], 'booked'),
    capacity: count(body['capacity'], 'capacity'),
  }
}

export function parseCancelResult(data: unknown): CancelResult {
  const body = record(data, 'cancel_booking_v1')
  if (!bool(body['ok'], 'ok')) return refusal(body, CANCEL_REFUSALS)
  return { ok: true, alreadyCancelled: bool(body['already_cancelled'], 'already_cancelled') }
}

function parseDay(value: unknown): DayAvailability {
  const body = record(value, 'dia')
  return {
    day: date(body['day'], 'day'),
    booked: count(body['booked'], 'booked'),
    closed: bool(body['closed'], 'closed'),
    mine: bool(body['mine'], 'mine'),
  }
}

export function parseAvailability(data: unknown): AvailabilityResult {
  const body = record(data, 'market_availability_v1')
  if (!bool(body['ok'], 'ok')) return refusal(body, AVAILABILITY_REFUSALS)
  const days = body['days']
  if (!Array.isArray(days)) throw invalid('days')
  return {
    ok: true,
    archived: bool(body['archived'], 'archived'),
    availability: {
      today: date(body['today'], 'today'),
      capacity: count(body['capacity'], 'capacity'),
      days: days.map(parseDay),
    },
  }
}
