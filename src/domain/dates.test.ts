import { describe, expect, it } from 'vitest'
import { addDays, parseIsoDate, startOfWeek, toIsoDate, weekDates, weekdayOf } from './dates'
import { DomainError } from './errors'

describe('datas de calendário (independentes de fuso)', () => {
  it('weekdayOf usa 0 = domingo e não muda com o fuso da máquina', () => {
    expect(weekdayOf('2026-10-18')).toBe(0)
    expect(weekdayOf('2026-10-19')).toBe(1)
    expect(weekdayOf('2026-10-24')).toBe(6)
  })

  it('a semana começa na segunda, e o domingo pertence à semana que termina nele', () => {
    expect(startOfWeek('2026-10-19')).toBe('2026-10-19')
    expect(startOfWeek('2026-10-22')).toBe('2026-10-19')
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19')
    expect(startOfWeek('2026-10-26')).toBe('2026-10-26')
  })

  it('weekDates devolve 7 dias começando na segunda', () => {
    expect(weekDates('2026-10-23')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ])
  })

  it('addDays atravessa mês, ano e ano bissexto', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('toIsoDate faz o caminho de volta', () => {
    expect(toIsoDate(parseIsoDate('2026-10-20'))).toBe('2026-10-20')
  })

  it.each(['abc', '2026-1-1', '2026-02-30', '2026-13-01', '', '2026-10-20T10:00:00Z'])(
    'recusa data inválida: %s',
    (value) => {
      expect(() => parseIsoDate(value)).toThrow(DomainError)
      expect(() => parseIsoDate(value)).toThrow(/Data inválida/)
    },
  )
})
