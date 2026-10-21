import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from './SegmentedControl'

const OPTIONS = [
  { value: 'a', label: 'Agenda' },
  { value: 'm', label: 'Mercados' },
] as const

describe('SegmentedControl', () => {
  it('marca a opção atual', () => {
    render(<SegmentedControl label="Área" options={OPTIONS} value="m" onChange={() => undefined} />)
    expect(screen.getByRole('button', { name: 'Mercados' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('group', { name: 'Área' })).toBeInTheDocument()
  })

  it('escolher outra opção avisa quem usa', async () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Área" options={OPTIONS} value="a" onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'Mercados' }))
    expect(onChange).toHaveBeenCalledWith('m')
  })
})
