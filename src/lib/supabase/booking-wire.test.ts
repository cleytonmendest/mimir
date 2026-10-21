import { describe, expect, it } from 'vitest'
import { parseAvailability, parseBookResult, parseCancelResult } from './booking-wire'
import { RequestFailure } from './errors'

describe('parseBookResult', () => {
  it('reserva feita', () => {
    expect(
      parseBookResult({ ok: true, booking_id: 'b-1', already_booked: false, booked: 2, capacity: 3 }),
    ).toEqual({ ok: true, bookingId: 'b-1', alreadyBooked: false, booked: 2, capacity: 3 })
  })

  it('recusa conhecida', () => {
    expect(parseBookResult({ ok: false, code: 'FULL' })).toEqual({ ok: false, code: 'FULL' })
  })

  it('recusa que este app não conhece vira UNRECOGNIZED, sem quebrar', () => {
    expect(parseBookResult({ ok: false, code: 'SUPPLIER_SUSPENDED' })).toEqual({
      ok: false,
      code: 'UNRECOGNIZED',
    })
  })

  it.each([
    null,
    'texto',
    [],
    {},
    { ok: 'sim' },
    { ok: false },
    { ok: false, code: '' },
    { ok: true, booking_id: 'b', already_booked: false, booked: -1, capacity: 3 },
    { ok: true, booking_id: 'b', already_booked: false, booked: 1.5, capacity: 3 },
    { ok: true, booking_id: '', already_booked: false, booked: 1, capacity: 3 },
    { ok: true, booking_id: 'b', already_booked: 'não', booked: 1, capacity: 3 },
  ])('resposta fora da forma é INVALID_RESPONSE: %j', (data) => {
    expect(() => parseBookResult(data)).toThrow(RequestFailure)
  })
})

describe('parseCancelResult', () => {
  it('cancelada, e cancelada de novo', () => {
    expect(parseCancelResult({ ok: true, already_cancelled: false })).toEqual({
      ok: true,
      alreadyCancelled: false,
    })
    expect(parseCancelResult({ ok: true, already_cancelled: true })).toEqual({
      ok: true,
      alreadyCancelled: true,
    })
  })

  it('recusas', () => {
    expect(parseCancelResult({ ok: false, code: 'PAST' })).toEqual({ ok: false, code: 'PAST' })
    expect(parseCancelResult({ ok: false, code: 'OUTRA' })).toEqual({
      ok: false,
      code: 'UNRECOGNIZED',
    })
  })

  it('fora da forma', () => {
    expect(() => parseCancelResult({ ok: true })).toThrow(RequestFailure)
  })
})

describe('parseAvailability', () => {
  const good = {
    ok: true,
    today: '2026-10-21',
    capacity: 3,
    archived: false,
    days: [{ day: '2026-10-22', booked: 1, closed: false, mine: true }],
  }

  it('o calendário de um mercado', () => {
    expect(parseAvailability(good)).toEqual({
      ok: true,
      archived: false,
      availability: {
        today: '2026-10-21',
        capacity: 3,
        days: [{ day: '2026-10-22', booked: 1, closed: false, mine: true }],
      },
    })
  })

  it('recusas', () => {
    expect(parseAvailability({ ok: false, code: 'INVALID_RANGE' })).toEqual({
      ok: false,
      code: 'INVALID_RANGE',
    })
    expect(parseAvailability({ ok: false, code: '???' })).toEqual({
      ok: false,
      code: 'UNRECOGNIZED',
    })
  })

  it.each([
    { ...good, days: 'x' },
    { ...good, today: '21/10/2026' },
    { ...good, archived: 'não' },
    { ...good, days: [{ day: '2026-10-22', booked: 'um', closed: false, mine: false }] },
    { ...good, days: [null] },
  ])('fora da forma: %j', (data) => {
    expect(() => parseAvailability(data)).toThrow(RequestFailure)
  })
})
