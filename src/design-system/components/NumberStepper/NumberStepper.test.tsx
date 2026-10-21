import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { NumberStepper } from './NumberStepper'

function setup(value: number, onChange = vi.fn()) {
  render(
    <NumberStepper
      value={value}
      min={1}
      max={5}
      onChange={onChange}
      label="Limite"
      unit="por dia"
    />,
  )
  return onChange
}

describe('NumberStepper', () => {
  it('mostra o valor e a unidade', () => {
    setup(3)
    expect(screen.getByRole('group', { name: 'Limite' })).toHaveTextContent('3')
    expect(screen.getByText('por dia')).toBeInTheDocument()
  })

  it('"+" e "−" pedem o valor ao lado', async () => {
    const onChange = setup(3)
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar: Limite' }))
    await userEvent.click(screen.getByRole('button', { name: 'Diminuir: Limite' }))
    expect(onChange.mock.calls).toEqual([[4], [2]])
  })

  it('no mínimo não diminui, no máximo não aumenta', () => {
    setup(1)
    expect(screen.getByRole('button', { name: 'Diminuir: Limite' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Aumentar: Limite' })).toBeEnabled()
    document.body.innerHTML = ''
    setup(5)
    expect(screen.getByRole('button', { name: 'Aumentar: Limite' })).toBeDisabled()
  })

  it('a unidade é opcional', () => {
    render(<NumberStepper value={2} min={1} max={5} onChange={() => undefined} label="Qtd" />)
    expect(screen.queryByText('por dia')).not.toBeInTheDocument()
  })

  it('dentro de um formulário, "+" e "−" não o enviam', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => {
      event.preventDefault()
    })
    render(
      <form onSubmit={onSubmit}>
        <NumberStepper value={3} min={1} max={5} onChange={() => undefined} label="Limite" />
      </form>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Aumentar: Limite' }))
    await userEvent.click(screen.getByRole('button', { name: 'Diminuir: Limite' }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
