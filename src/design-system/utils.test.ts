import { describe, expect, it } from 'vitest'
import { cn } from './utils'

describe('cn', () => {
  it('a última classe de Tailwind vence o conflito', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4')
    expect(cn('h-9', ['h-11'])).toBe('h-11')
  })

  it('aceita condicionais e ignora o que é falso', () => {
    expect(cn('bg-primary', false, { 'text-foreground': true, hidden: false })).toBe(
      'bg-primary text-foreground',
    )
  })
})
