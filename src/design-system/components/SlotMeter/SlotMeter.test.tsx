import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SlotMeter } from './SlotMeter'

describe('SlotMeter', () => {
  it('um traço por estande, os reservados cheios', () => {
    const { container } = render(<SlotMeter booked={2} capacity={3} />)
    const pips = container.querySelectorAll('i')
    expect(pips).toHaveLength(3)
    expect([...pips].map((pip) => pip.dataset['filled'])).toEqual(['true', 'true', 'false'])
  })

  it('diz em texto quantos estão reservados', () => {
    render(<SlotMeter booked={1} capacity={3} />)
    expect(screen.getByRole('img', { name: '1 de 3 estandes reservados' })).toBeInTheDocument()
  })

  it('a cor acompanha o estado: livre, em parte, lotado', () => {
    const tone = (booked: number) =>
      render(<SlotMeter booked={booked} capacity={3} decorative />).container.querySelector('span')
        ?.dataset['tone']
    expect(tone(0)).toBe('free')
    expect(tone(2)).toBe('partial')
    expect(tone(3)).toBe('full')
  })

  it('com mais reservas que o limite mostra todas e conta como lotado', () => {
    const { container } = render(<SlotMeter booked={4} capacity={3} decorative />)
    expect(container.querySelectorAll('i')).toHaveLength(4)
    expect(container.querySelector('span')?.dataset['tone']).toBe('full')
  })

  it('decorativo some para o leitor de tela', () => {
    render(<SlotMeter booked={1} capacity={3} decorative />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
