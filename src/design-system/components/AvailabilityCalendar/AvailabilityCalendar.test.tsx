import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { DayAvailability } from '@/domain/booking'
import { AvailabilityCalendar } from './AvailabilityCalendar'

const TODAY = '2026-10-21'
const DAYS: DayAvailability[] = [
  { day: '2026-10-22', booked: 3, closed: false, mine: false },
  { day: '2026-10-24', booked: 1, closed: false, mine: true },
  { day: '2026-10-26', booked: 0, closed: true, mine: false },
]

function setup(props: Partial<Parameters<typeof AvailabilityCalendar>[0]> = {}) {
  const onSelect = vi.fn()
  const onMonthChange = vi.fn()
  render(
    <AvailabilityCalendar
      month={{ year: 2026, month: 10 }}
      today={TODAY}
      capacity={3}
      days={DAYS}
      selected={null}
      showMine
      onSelect={onSelect}
      onMonthChange={onMonthChange}
      {...props}
    />,
  )
  return { onSelect, onMonthChange }
}

const day = (name: RegExp) => screen.getByRole('button', { name })

describe('AvailabilityCalendar', () => {
  it('mostra o mês e o subtítulo', () => {
    setup({ subtitle: 'Mercado Central' })
    expect(screen.getByRole('heading', { name: 'Outubro de 2026' })).toBeInTheDocument()
    expect(screen.getByText('Mercado Central')).toBeInTheDocument()
  })

  it('cada dia diz o estado em texto, não só em cor', () => {
    setup()
    expect(day(/^Quinta-feira, 22 de outubro: lotado/)).toBeInTheDocument()
    expect(day(/^Sábado, 24 de outubro: 2 vagas livres de 3. Sua reserva/)).toBeInTheDocument()
    expect(day(/^Segunda-feira, 26 de outubro: fechado para reservas/)).toBeInTheDocument()
    expect(day(/^Sexta-feira, 23 de outubro: 3 vagas livres de 3/)).toBeInTheDocument()
    expect(day(/^Terça-feira, 27 de outubro: 3 vagas livres de 3/)).toBeInTheDocument()
  })

  it('hoje e os dias que já passaram não se escolhem; hoje é marcado', () => {
    setup()
    const hoje = day(/^Quarta-feira, 21 de outubro: indisponível, já passou. Hoje/)
    expect(hoje).toBeDisabled()
    expect(day(/^Terça-feira, 20 de outubro/)).toBeDisabled()
  })

  it('depois da janela de 60 dias não se escolhe', () => {
    setup({ month: { year: 2026, month: 12 } })
    expect(day(/^Domingo, 20 de dezembro: 3 vagas/)).toBeEnabled()
    expect(day(/^Segunda-feira, 21 de dezembro: ainda não abre/)).toBeDisabled()
  })

  it('escolher um dia avisa quem usa, e o escolhido fica marcado', async () => {
    const { onSelect } = setup({ selected: '2026-10-24' })
    expect(day(/^Sábado, 24 de outubro/)).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(day(/^Sexta-feira, 23 de outubro/))
    expect(onSelect).toHaveBeenCalledWith('2026-10-23')
  })

  it('o administrador não vê a marca "sua reserva"', () => {
    setup({ showMine: false })
    expect(screen.queryByText(/Sua reserva/)).not.toBeInTheDocument()
    expect(day(/^Sábado, 24 de outubro: 2 vagas livres de 3$/)).toBeInTheDocument()
  })

  it('só navega entre os meses que têm dia reservável', async () => {
    const { onMonthChange } = setup()
    expect(screen.getByRole('button', { name: 'Mês anterior' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Próximo mês' }))
    expect(onMonthChange).toHaveBeenCalledWith({ year: 2026, month: 11 })
  })

  it('no último mês da janela não avança, mas volta', async () => {
    const { onMonthChange } = setup({ month: { year: 2026, month: 12 } })
    expect(screen.getByRole('button', { name: 'Próximo mês' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Mês anterior' }))
    expect(onMonthChange).toHaveBeenCalledWith({ year: 2026, month: 11 })
  })

  it('o dia sem informação do servidor conta como livre', () => {
    setup({ days: [] })
    expect(day(/^Sábado, 24 de outubro: 3 vagas livres de 3/)).toBeInTheDocument()
  })

  it('a legenda explica os traços e a janela', () => {
    setup()
    const legend = screen.getByText('Livre').closest('ul') as HTMLElement
    expect(within(legend).getByText('Sua reserva')).toBeInTheDocument()
    expect(screen.getByText(/Cada traço é um estande/)).toHaveTextContent('60 dias à frente')
  })

  describe('teclado', () => {
    it('as setas levam o foco ao dia vizinho; para cima e para baixo, uma semana', async () => {
      setup()
      const user = userEvent.setup()
      day(/^Terça-feira, 27 de outubro/).focus()

      await user.keyboard('{ArrowRight}')
      expect(day(/^Quarta-feira, 28 de outubro/)).toHaveFocus()
      await user.keyboard('{ArrowLeft}{ArrowLeft}')
      expect(day(/^Segunda-feira, 26 de outubro/)).toHaveFocus()
      day(/^Sexta-feira, 23 de outubro/).focus()
      await user.keyboard('{ArrowDown}')
      expect(day(/^Sexta-feira, 30 de outubro/)).toHaveFocus()
      await user.keyboard('{ArrowUp}')
      expect(day(/^Sexta-feira, 23 de outubro/)).toHaveFocus()
    })

    it('não vai para dias que não dá para escolher (os que já passaram ficam desligados)', async () => {
      setup()
      const user = userEvent.setup()
      // Quinta 22 é o primeiro dia reservável (amanhã); antes dele só há dias desligados.
      day(/^Quinta-feira, 22 de outubro/).focus()
      await user.keyboard('{ArrowLeft}{ArrowUp}')
      expect(day(/^Quinta-feira, 22 de outubro/)).toHaveFocus()
    })

    it('não sai do mês mostrado', async () => {
      setup()
      const user = userEvent.setup()
      day(/^Sábado, 31 de outubro/).focus()
      await user.keyboard('{ArrowRight}{ArrowDown}')
      expect(day(/^Sábado, 31 de outubro/)).toHaveFocus()
    })

    it('Enter escolhe o dia com o foco, e as outras teclas seguem o caminho normal', async () => {
      const { onSelect } = setup()
      const user = userEvent.setup()
      day(/^Sexta-feira, 23 de outubro/).focus()
      await user.keyboard('x')
      expect(onSelect).not.toHaveBeenCalled()
      await user.keyboard('{Enter}')
      expect(onSelect).toHaveBeenCalledWith('2026-10-23')
    })
  })
})
