import { describe, expect, it } from 'vitest'
import { formatLongDate, formatTime } from './format'

describe('formatLongDate', () => {
  it('escreve o dia da semana e a data por extenso, com a primeira letra maiúscula', () => {
    expect(formatLongDate('2026-10-21')).toBe('Quarta-feira, 21 de outubro')
    expect(formatLongDate('2026-03-01')).toBe('Domingo, 1 de março')
  })

  it('o dia mostrado é o da data recebida, em qualquer fuso', () => {
    expect(formatLongDate('2026-12-31')).toBe('Quinta-feira, 31 de dezembro')
    expect(formatLongDate('2026-01-01')).toBe('Quinta-feira, 1 de janeiro')
  })
})

describe('formatTime', () => {
  it('mostra a hora no relógio do aparelho, com dois dígitos', () => {
    expect(formatTime(new Date(2026, 9, 21, 8, 5).toISOString())).toBe('08:05')
    expect(formatTime(new Date(2026, 9, 21, 23, 59).toISOString())).toBe('23:59')
  })
})
