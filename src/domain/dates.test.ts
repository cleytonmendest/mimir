import { describe, expect, it } from 'vitest'
import {
  addDays,
  COMPANY_TIME_ZONE,
  companyDate,
  daysBetween,
  parseIsoDate,
  startOfWeek,
  toIsoDate,
  weekDates,
  weekdayOf,
} from './dates'
import { DomainError } from './errors'

describe('o dia no fuso da empresa', () => {
  it('o fuso é o de Brasília', () => {
    expect(COMPANY_TIME_ZONE).toBe('America/Sao_Paulo')
  })

  it('virada do dia: 23:59 em Brasília ainda é o dia anterior, 00:00 já é o seguinte', () => {
    expect(companyDate('2026-10-21T02:59:59.999Z')).toBe('2026-10-20')
    expect(companyDate('2026-10-21T03:00:00.000Z')).toBe('2026-10-21')
  })

  it('meio-dia e fim de tarde ficam no mesmo dia, mesmo que em UTC já seja o dia seguinte', () => {
    expect(companyDate('2026-10-21T15:00:00Z')).toBe('2026-10-21')
    expect(companyDate('2026-10-22T02:30:00Z')).toBe('2026-10-21')
  })

  it('aceita Date e texto ISO com deslocamento, e dá o mesmo dia', () => {
    const instant = new Date('2026-10-21T02:30:00Z')
    expect(companyDate(instant)).toBe('2026-10-20')
    expect(companyDate('2026-10-20T23:30:00-03:00')).toBe('2026-10-20')
    expect(companyDate('2026-10-21T10:00:00+10:00')).toBe('2026-10-20')
  })

  it('usa o fuso certo também em datas antigas, do tempo do horário de verão', () => {
    expect(companyDate('2018-11-04T02:59:00Z')).toBe('2018-11-03')
    expect(companyDate('2018-11-04T03:00:00Z')).toBe('2018-11-04')
  })

  it.each(['abc', '', '2026-13-01T00:00:00Z'])('recusa instante inválido: %s', (value) => {
    expect(() => companyDate(value)).toThrow(DomainError)
    expect(() => companyDate(value)).toThrow(/Instante inválido/)
  })

  it('recusa Date inválida', () => {
    expect(() => companyDate(new Date('x'))).toThrow(DomainError)
  })
})

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

  it('addDays e weekDates não escorregam um dia na virada do horário de verão', () => {
    // EUA (8/3 e 1/11 de 2026), Europa (29/3 e 25/10 de 2026) e Brasil (horário de verão até 2019)
    expect(addDays('2026-03-07', 1)).toBe('2026-03-08')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26')
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02')
    expect(addDays('2018-11-03', 2)).toBe('2018-11-05')
    expect(addDays('2026-03-09', -2)).toBe('2026-03-07')
    expect(weekDates('2026-03-04')).toEqual([
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
      '2026-03-06',
      '2026-03-07',
      '2026-03-08',
    ])
  })

  it('daysBetween conta dias de calendário, também para trás e atravessando mês e ano', () => {
    expect(daysBetween('2026-10-21', '2026-10-21')).toBe(0)
    expect(daysBetween('2026-10-21', '2026-12-20')).toBe(60)
    expect(daysBetween('2026-10-21', '2026-10-20')).toBe(-1)
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2)
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
