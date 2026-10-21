import { describe, expect, it } from 'vitest'
import { dayMonth, longDate, monthTitle, plural, shortDate, weekdayLabels } from './format'

describe('datas em português', () => {
  it('data por extenso, com a primeira letra maiúscula', () => {
    expect(longDate('2026-10-24')).toBe('Sábado, 24 de outubro')
    expect(longDate('2026-12-01')).toBe('Terça-feira, 1 de dezembro')
  })

  it('dia e mês, e dia da semana abreviado', () => {
    expect(dayMonth('2026-10-05')).toBe('05/10')
    expect(shortDate('2026-10-24')).toBe('sáb 24/10')
    expect(shortDate('2026-10-29')).toBe('qui 29/10')
  })

  it('título do mês', () => {
    expect(monthTitle({ year: 2026, month: 10 })).toBe('Outubro de 2026')
    expect(monthTitle({ year: 2027, month: 1 })).toBe('Janeiro de 2027')
  })

  it('os sete dias da semana, de domingo a sábado', () => {
    const labels = weekdayLabels()
    expect(labels.map((label) => label.short)).toEqual([
      'dom',
      'seg',
      'ter',
      'qua',
      'qui',
      'sex',
      'sáb',
    ])
    expect(labels[0]?.full).toBe('domingo')
    expect(labels[6]?.full).toBe('sábado')
  })

  it('plural', () => {
    expect(plural(1, 'vaga livre', 'vagas livres')).toBe('1 vaga livre')
    expect(plural(0, 'vaga livre', 'vagas livres')).toBe('0 vagas livres')
    expect(plural(3, 'vaga livre', 'vagas livres')).toBe('3 vagas livres')
  })
})
