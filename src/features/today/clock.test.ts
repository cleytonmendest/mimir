import { afterEach, describe, expect, it, vi } from 'vitest'
import { localIsoDate, systemClock } from './clock'

afterEach(() => {
  vi.useRealTimers()
})

describe('localIsoDate', () => {
  it('é o dia do calendário do aparelho, com mês e dia de dois dígitos', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05')
    expect(localIsoDate(new Date(2026, 11, 31, 23, 59))).toBe('2026-12-31')
  })

  it('às 23h30 ainda é o mesmo dia, mesmo que em UTC já seja o dia seguinte (ou o anterior)', () => {
    // Em fusos atrás de UTC (ex.: Los Angeles) o instante cai no dia seguinte em UTC:
    // toISOString().slice(0, 10) erraria aqui, e o app mostraria as visitas do dia errado.
    const lateNight = new Date(2026, 9, 21, 23, 30)
    expect(localIsoDate(lateNight)).toBe('2026-10-21')

    const justAfterMidnight = new Date(2026, 9, 21, 0, 30)
    expect(localIsoDate(justAfterMidnight)).toBe('2026-10-21')
  })

  it('não escorrega na virada do horário de verão', () => {
    expect(localIsoDate(new Date(2026, 10, 1, 1, 30))).toBe('2026-11-01')
    expect(localIsoDate(new Date(2026, 2, 8, 2, 30))).toBe('2026-03-08')
  })
})

describe('systemClock', () => {
  it('lê o instante e o dia local juntos, do mesmo relógio', () => {
    vi.useFakeTimers()
    const moment = new Date(2026, 9, 21, 23, 30)
    vi.setSystemTime(moment)

    expect(systemClock()).toEqual({ now: moment.toISOString(), today: '2026-10-21' })
  })
})
