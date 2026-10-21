import { describe, expect, it } from 'vitest'
import {
  addMonths,
  bookableMonths,
  compareMonths,
  daysInMonth,
  firstDayOf,
  monthGrid,
  monthOf,
} from './calendar'

describe('meses', () => {
  it('monthOf lê o mês de uma data', () => {
    expect(monthOf('2026-10-21')).toEqual({ year: 2026, month: 10 })
  })

  it('addMonths atravessa o ano para os dois lados', () => {
    expect(addMonths({ year: 2026, month: 11 }, 2)).toEqual({ year: 2027, month: 1 })
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 })
    expect(addMonths({ year: 2026, month: 5 }, 0)).toEqual({ year: 2026, month: 5 })
  })

  it('compareMonths ordena', () => {
    expect(compareMonths({ year: 2026, month: 10 }, { year: 2026, month: 12 })).toBeLessThan(0)
    expect(compareMonths({ year: 2027, month: 1 }, { year: 2026, month: 12 })).toBeGreaterThan(0)
    expect(compareMonths({ year: 2026, month: 3 }, { year: 2026, month: 3 })).toBe(0)
  })

  it('firstDayOf e daysInMonth, com fevereiro de ano bissexto', () => {
    expect(firstDayOf({ year: 2026, month: 3 })).toBe('2026-03-01')
    expect(daysInMonth({ year: 2026, month: 10 })).toBe(31)
    expect(daysInMonth({ year: 2026, month: 2 })).toBe(28)
    expect(daysInMonth({ year: 2028, month: 2 })).toBe(29)
  })
})

describe('monthGrid', () => {
  it('outubro de 2026 começa numa quinta: quatro vazios, depois os 31 dias', () => {
    const grid = monthGrid({ year: 2026, month: 10 })
    expect(grid.slice(0, 4)).toEqual([null, null, null, null])
    expect(grid[4]).toBe('2026-10-01')
    expect(grid.at(-1)).toBe('2026-10-31')
    expect(grid).toHaveLength(35)
  })

  it('um mês que começa no domingo não tem vazios', () => {
    expect(monthGrid({ year: 2026, month: 11 })[0]).toBe('2026-11-01')
  })
})

describe('bookableMonths', () => {
  it('do mês de amanhã ao mês do último dia da janela', () => {
    expect(bookableMonths('2026-10-21', 60)).toEqual({
      first: { year: 2026, month: 10 },
      last: { year: 2026, month: 12 },
    })
    expect(bookableMonths('2026-10-31', 60).first).toEqual({ year: 2026, month: 11 })
  })
})
