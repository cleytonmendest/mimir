import { act, cleanup, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { TextField } from '@/design-system/components/TextField/TextField'
import { checkAll, useValidatedField } from './useValidatedField'

afterEach(cleanup)

const required = (value: string) => (value.trim() === '' ? 'Informe o nome.' : null)

function Form() {
  const name = useValidatedField(required)
  const email = useValidatedField((value) => (value.includes('@') ? null : 'E-mail torto.'))
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        checkAll([name, email])
      }}
    >
      <TextField
        id="name"
        label="Nome"
        value={name.value}
        error={name.error}
        inputRef={name.ref}
        onChange={(event) => {
          name.change(event.target.value)
        }}
        onFocus={name.focus}
        onBlur={name.blur}
      />
      <TextField
        id="email"
        label="E-mail"
        value={email.value}
        error={email.error}
        inputRef={email.ref}
        onChange={(event) => {
          email.change(event.target.value)
        }}
        onFocus={email.focus}
        onBlur={email.blur}
      />
      <button type="submit">Enviar</button>
    </form>
  )
}

describe('useValidatedField', () => {
  it('não reclama enquanto se digita num campo intocado', async () => {
    const user = userEvent.setup()
    render(<Form />)
    await user.type(screen.getByLabelText('E-mail'), 'ana')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('reclama ao sair do campo, e o erro some ao voltar para ele', async () => {
    const user = userEvent.setup()
    render(<Form />)
    await user.click(screen.getByLabelText('Nome'))
    await user.tab()
    expect(screen.getByText('Informe o nome.')).toHaveAttribute('role', 'alert')
    expect(screen.getByLabelText('Nome')).toHaveAttribute('aria-invalid', 'true')

    await user.click(screen.getByLabelText('Nome'))
    expect(screen.queryByText('Informe o nome.')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Nome')).not.toHaveAttribute('aria-invalid')
  })

  it('o erro some na primeira tecla de correção e volta se continuar errado ao sair', async () => {
    const user = userEvent.setup()
    render(<Form />)
    await user.type(screen.getByLabelText('E-mail'), 'ana')
    await user.tab()
    expect(screen.getByRole('alert')).toHaveTextContent('E-mail torto.')

    await user.click(screen.getByLabelText('E-mail'))
    await user.keyboard('x')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.tab()
    expect(screen.getByRole('alert')).toHaveTextContent('E-mail torto.')

    await user.click(screen.getByLabelText('E-mail'))
    await user.keyboard('@a.com')
    await user.tab()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('no envio mostra todos os erros e leva o foco ao primeiro, sem apagar o erro dele', async () => {
    const user = userEvent.setup()
    render(<Form />)
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'Informe o nome.',
      'E-mail torto.',
    ])
    expect(screen.getByLabelText('Nome')).toHaveFocus()
    expect(screen.getByLabelText('Nome')).toHaveAttribute('aria-invalid', 'true')
  })

  it('o foco que o envio dá ao campo errado não apaga o erro; a primeira tecla apaga', async () => {
    const user = userEvent.setup()
    render(<Form />)
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(screen.getByLabelText('Nome')).toHaveFocus()
    expect(screen.getByText('Informe o nome.')).toBeInTheDocument()

    await user.keyboard('A')
    expect(screen.queryByText('Informe o nome.')).not.toBeInTheDocument()
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'E-mail torto.',
    ])
  })

  it('ao ir para o botão de enviar o erro espera o clique (não empurra o botão no meio do toque)', async () => {
    const user = userEvent.setup()
    render(<Form />)
    const button = screen.getByRole('button', { name: 'Enviar' })
    await user.click(screen.getByLabelText('Nome'))

    await user.pointer({ keys: '[MouseLeft>]', target: button })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.pointer({ keys: '[/MouseLeft]' })
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'Informe o nome.',
      'E-mail torto.',
    ])
    expect(screen.getByLabelText('Nome')).toHaveFocus()
  })

  it('com Tab o erro aparece na hora, mesmo que o próximo foco seja um botão', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Form />
        <button>Outro</button>
      </>,
    )
    // Sai do e-mail (o último campo) direto para o botão de enviar, com o teclado.
    await user.click(screen.getByLabelText('E-mail'))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Enviar' })).toHaveFocus()
    expect(screen.getByRole('alert')).toHaveTextContent('E-mail torto.')
  })

  it('com tudo certo, o envio segue', async () => {
    const user = userEvent.setup()
    render(<Form />)
    await user.type(screen.getByLabelText('Nome'), 'Ana')
    await user.type(screen.getByLabelText('E-mail'), 'ana@a.com')
    await user.click(screen.getByRole('button', { name: 'Enviar' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('useValidatedField: sem tela', () => {
  it('check devolve se está bom e reset limpa valor e erro', () => {
    const { result } = renderHook(() => useValidatedField(required))
    let ok = true
    act(() => {
      ok = result.current.check()
    })
    expect(ok).toBe(false)
    expect(result.current.error).toBe('Informe o nome.')

    act(() => {
      result.current.reset('Ana')
    })
    expect(result.current.value).toBe('Ana')
    expect(result.current.error).toBeNull()
    act(() => {
      ok = result.current.check()
    })
    expect(ok).toBe(true)
  })

  it('checkAll confere todos, mesmo depois do primeiro erro, e diz se pode seguir', () => {
    const { result } = renderHook(() => ({
      a: useValidatedField(required),
      b: useValidatedField(required, 'ok'),
      c: useValidatedField(required),
    }))
    let ok = true
    act(() => {
      ok = checkAll([result.current.a, result.current.b, result.current.c])
    })
    expect(ok).toBe(false)
    expect(result.current.a.error).toBe('Informe o nome.')
    expect(result.current.b.error).toBeNull()
    expect(result.current.c.error).toBe('Informe o nome.')

    act(() => {
      result.current.a.change('x')
      result.current.c.change('y')
    })
    act(() => {
      ok = checkAll([result.current.a, result.current.b, result.current.c])
    })
    expect(ok).toBe(true)
  })
})
