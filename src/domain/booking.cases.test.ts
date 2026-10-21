import { describe, expect, it } from 'vitest'
import { addDays } from './dates'
import { evaluateBooking, type BookingDecision } from './booking'
import cases from './fixtures/booking.cases.json'
import type { Actor } from './types'

/**
 * Os mesmos casos que o banco cumpre em 70_booking_cases.test.sql (gerado do mesmo JSON): o que
 * impede a regra do TypeScript e a do SQL de se separarem.
 */
const TODAY = '2026-10-21'

interface Case {
  name: string
  role: Actor['role']
  dayOffset: number
  marketArchived: boolean
  closed: boolean
  capacity: number
  booked: number
  mine: boolean
  expect: BookingDecision
}

describe('casos compartilhados de reserva', () => {
  it('há casos', () => {
    expect(cases.cases.length).toBeGreaterThan(0)
  })

  it.each(cases.cases as Case[])('$name', (item) => {
    const decision = evaluateBooking({
      actor: { id: 'u-actor', role: item.role },
      today: TODAY,
      day: addDays(TODAY, item.dayOffset),
      slot: {
        marketArchived: item.marketArchived,
        closed: item.closed,
        capacity: item.capacity,
        booked: item.booked,
        mine: item.mine,
      },
    })
    expect(decision).toEqual(item.expect)
  })
})
