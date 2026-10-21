import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SyncStatus, type SyncTone } from './SyncStatus'

describe('SyncStatus', () => {
  it('mostra o que está acontecendo e avisa leitores de tela sem interromper', () => {
    render(<SyncStatus tone="ok" title="Tudo enviado" detail="Último envio às 10:32." />)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Tudo enviado')
    expect(status).toHaveTextContent('Último envio às 10:32.')
  })

  it('sem detalhe nem ação, só o título', () => {
    render(<SyncStatus tone="working" title="Enviando…" />)

    expect(screen.getByRole('status').querySelectorAll('p')).toHaveLength(1)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('a ação aparece como botão e dispara ao tocar', async () => {
    const onClick = vi.fn()
    render(
      <SyncStatus tone="waiting" title="2 registros" action={{ label: 'Enviar agora', onClick }} />,
    )

    await userEvent.setup().click(screen.getByRole('button', { name: 'Enviar agora' }))

    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('cada tom tem uma cor própria (não depende só de texto)', () => {
    const tones: SyncTone[] = ['ok', 'working', 'waiting', 'problem']
    const classes = tones.map((tone) => {
      const { container, unmount } = render(<SyncStatus tone={tone} title="x" />)
      const value = container.firstElementChild?.className ?? ''
      unmount()
      return value
    })
    expect(new Set(classes).size).toBe(tones.length)
  })
})
