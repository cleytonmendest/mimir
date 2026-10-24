import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { SearchField } from './SearchField'

function Controlled({ onChange }: { onChange?: (value: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <SearchField
      label="Buscar por bairro ou nome"
      value={value}
      onChange={(next) => {
        setValue(next)
        onChange?.(next)
      }}
      summary={value === '' ? null : `busca: ${value}`}
    />
  )
}

describe('SearchField', () => {
  it('tem rótulo e é um campo de busca', () => {
    render(<SearchField label="Buscar" value="" onChange={vi.fn()} />)
    const field = screen.getByRole('searchbox', { name: 'Buscar' })
    expect(field).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Limpar busca' })).not.toBeInTheDocument()
  })

  it('avisa a cada letra digitada', async () => {
    const onChange = vi.fn<(value: string) => void>()
    render(<Controlled onChange={onChange} />)
    await userEvent.type(screen.getByRole('searchbox'), 'leb')
    expect(onChange.mock.calls.map(([value]) => value)).toEqual(['l', 'le', 'leb'])
  })

  it('mostra o resumo numa região viva, sem tomar o papel "status" do aviso de sucesso', async () => {
    render(<Controlled />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await userEvent.type(screen.getByRole('searchbox'), 'x')
    const summary = screen.getByText('busca: x')
    expect(summary).toHaveAttribute('aria-live', 'polite')
  })

  it('o "x" aparece com texto, limpa e devolve o foco ao campo', async () => {
    render(<Controlled />)
    const field = screen.getByRole('searchbox')
    await userEvent.type(field, 'gavea')
    await userEvent.click(screen.getByRole('button', { name: 'Limpar busca' }))
    expect(field).toHaveValue('')
    expect(field).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Limpar busca' })).not.toBeInTheDocument()
  })
})
