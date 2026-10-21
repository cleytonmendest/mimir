import { afterEach, describe, expect, it, vi } from 'vitest'
import { systemClock } from './clock'

afterEach(() => {
  vi.useRealTimers()
})

describe('systemClock', () => {
  it('lê o instante e o dia de Brasília juntos, do mesmo relógio', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-21T14:30:00.000Z'))

    expect(systemClock()).toEqual({ now: '2026-10-21T14:30:00.000Z', today: '2026-10-21' })
  })

  it('23h59 em Brasília ainda é o dia anterior, e à meia-noite vira o dia (em qualquer fuso do aparelho)', () => {
    // Em UTC os dois instantes já são o dia 21; em fusos adiantados (Kiritimati) também, e em fusos
    // atrasados (Los Angeles) o primeiro ainda é dia 20. Só a regra do fuso da empresa acerta todos.
    vi.useFakeTimers()

    vi.setSystemTime(new Date('2026-10-21T02:59:00.000Z'))
    expect(systemClock().today).toBe('2026-10-20')

    vi.setSystemTime(new Date('2026-10-21T03:00:00.000Z'))
    expect(systemClock().today).toBe('2026-10-21')
  })
})
