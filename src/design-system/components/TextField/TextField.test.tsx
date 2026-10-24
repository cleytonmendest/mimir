import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TextField } from './TextField'

afterEach(cleanup)

describe('TextField', () => {
  it('o rótulo está ligado ao campo', () => {
    render(<TextField id="nome" label="Nome ou empresa" />)
    expect(screen.getByLabelText('Nome ou empresa')).toBe(screen.getByRole('textbox'))
  })

  it('sem erro, o campo não é marcado como inválido', () => {
    render(<TextField id="nome" label="Nome" />)
    const field = screen.getByRole('textbox')
    expect(field).not.toHaveAttribute('aria-invalid')
    expect(field).not.toHaveAttribute('aria-describedby')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('com erro, anuncia a mensagem e liga ela ao campo', () => {
    render(<TextField id="nome" label="Nome" error="Informe o nome." />)
    const field = screen.getByRole('textbox')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('Informe o nome.')
    expect(field).toHaveAccessibleDescription('Informe o nome.')
  })

  it('a dica e o erro vão juntos na descrição', () => {
    render(
      <TextField
        id="senha"
        label="Senha"
        hint="Pelo menos 10 caracteres."
        error="A senha é curta."
      />,
    )
    expect(screen.getByLabelText('Senha')).toHaveAccessibleDescription(
      'Pelo menos 10 caracteres. A senha é curta.',
    )
  })

  it('repassa o resto ao campo', () => {
    render(<TextField id="mail" label="E-mail" type="email" autoComplete="email" maxLength={254} />)
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('type', 'email')
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('autocomplete', 'email')
    expect(screen.getByLabelText('E-mail')).toHaveAttribute('maxlength', '254')
  })
})
