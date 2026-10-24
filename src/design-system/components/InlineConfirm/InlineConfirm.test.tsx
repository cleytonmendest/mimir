import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlineConfirm } from './InlineConfirm'
import { useFocusReturn } from './useFocusReturn'

afterEach(cleanup)

function setup(props: Partial<React.ComponentProps<typeof InlineConfirm>> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()
  render(
    <InlineConfirm
      label="Confirmar cancelamento"
      title="Cancelar a reserva de seg 26/10 em Loja 07 - Leblon?"
      description="A vaga volta a ficar livre."
      confirmLabel="Sim, cancelar"
      cancelLabel="Manter"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  )
  return { onConfirm, onCancel, user: userEvent.setup() }
}

describe('InlineConfirm', () => {
  it('diz o que será afetado e leva o foco para a opção segura', () => {
    setup()
    const group = screen.getByRole('group', { name: 'Confirmar cancelamento' })
    expect(group).toHaveTextContent('Cancelar a reserva de seg 26/10 em Loja 07 - Leblon?')
    expect(group).toHaveTextContent('A vaga volta a ficar livre.')
    expect(screen.getByRole('button', { name: 'Manter' })).toHaveFocus()
    // O leitor de tela lê a pergunta ao cair no botão seguro.
    expect(screen.getByRole('button', { name: 'Manter' })).toHaveAccessibleDescription(
      'Cancelar a reserva de seg 26/10 em Loja 07 - Leblon? A vaga volta a ficar livre.',
    )
  })

  it('confirmar e manter avisam quem usa', async () => {
    const { onConfirm, onCancel, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Sim, cancelar' }))
    expect(onConfirm).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Manter' }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('Esc cancela sem confirmar', async () => {
    const { onConfirm, onCancel, user } = setup()
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('ocupado, os dois botões ficam desligados', () => {
    setup({ busy: true })
    expect(screen.getByRole('button', { name: 'Sim, cancelar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Manter' })).toBeDisabled()
  })

  it('aceita um campo extra entre a pergunta e os botões', () => {
    setup({ children: <input aria-label="Motivo" /> })
    const group = screen.getByRole('group')
    const field = screen.getByRole('textbox', { name: 'Motivo' })
    const confirm = screen.getByRole('button', { name: 'Sim, cancelar' })
    expect(group).toContainElement(field)
    expect(field.compareDocumentPosition(confirm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('sem descrição, só a pergunta', () => {
    setup({ description: undefined })
    expect(screen.getByRole('group')).not.toHaveTextContent('A vaga volta')
  })
})

function Host() {
  const [asking, setAsking] = useState(false)
  const trigger = useFocusReturn<HTMLButtonElement>(asking)
  return asking ? (
    <InlineConfirm
      label="Confirmar"
      title="Apagar?"
      confirmLabel="Sim, apagar"
      cancelLabel="Manter"
      onConfirm={() => undefined}
      onCancel={() => {
        setAsking(false)
      }}
    />
  ) : (
    <button
      ref={trigger}
      onClick={() => {
        setAsking(true)
      }}
    >
      Apagar
    </button>
  )
}

describe('useFocusReturn', () => {
  it('ao manter, o foco volta ao botão que abriu a confirmação', async () => {
    const user = userEvent.setup()
    render(<Host />)
    screen.getByRole('button', { name: 'Apagar' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('button', { name: 'Manter' })).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Apagar' })).toHaveFocus()
  })
})
