import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NoticeToast } from './NoticeToast'

afterEach(() => {
  vi.useRealTimers()
})

describe('NoticeToast', () => {
  it('sem aviso não mostra nada', () => {
    const { container } = render(<NoticeToast notice={null} onClose={() => undefined} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('o aviso de sucesso some sozinho depois de uns segundos', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(
      <NoticeToast
        notice={{ id: 1, kind: 'success', text: 'Reserva confirmada.' }}
        onClose={onClose}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Reserva confirmada.')

    act(() => {
      vi.advanceTimersByTime(6_900)
    })
    expect(onClose).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('o erro fica até a pessoa fechar', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    render(<NoticeToast notice={{ id: 2, kind: 'error', text: 'Não deu.' }} onClose={onClose} />)
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Não deu.')
  })

  it('um aviso novo reinicia a contagem', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const { rerender } = render(
      <NoticeToast notice={{ id: 1, kind: 'info', text: 'Um' }} onClose={onClose} />,
    )
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    rerender(<NoticeToast notice={{ id: 2, kind: 'info', text: 'Dois' }} onClose={onClose} />)
    act(() => {
      vi.advanceTimersByTime(5_000)
    })
    expect(onClose).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(2_100)
    })
    expect(onClose).toHaveBeenCalledOnce()
  })
})
