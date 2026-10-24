import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWideScreen } from './useWideScreen'

function Probe() {
  return <p>{useWideScreen() ? 'larga' : 'estreita'}</p>
}

/** Um matchMedia que deixa o teste mudar a largura e ver quem ouve. */
function fakeScreen(initial: boolean) {
  let matches = initial
  const listeners = new Set<() => void>()
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() {
      return matches
    },
    media: query,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }))
  return {
    listeners,
    resize(next: boolean) {
      matches = next
      act(() => {
        listeners.forEach((listener) => {
          listener()
        })
      })
    },
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useWideScreen', () => {
  it('sem como medir a tela, vale como larga', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<Probe />)
    expect(screen.getByText('larga')).toBeInTheDocument()
  })

  it('acompanha a largura e para de ouvir ao sair da tela', () => {
    const fake = fakeScreen(false)
    const { unmount } = render(<Probe />)
    expect(screen.getByText('estreita')).toBeInTheDocument()
    expect(fake.listeners.size).toBe(1)

    fake.resize(true)
    expect(screen.getByText('larga')).toBeInTheDocument()
    fake.resize(false)
    expect(screen.getByText('estreita')).toBeInTheDocument()

    unmount()
    expect(fake.listeners.size).toBe(0)
  })
})
