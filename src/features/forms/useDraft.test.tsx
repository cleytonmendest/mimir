import { act, render, renderHook, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DraftNotice } from './DraftNotice'
import { clearDrafts, useDraft, useDraftSync } from './useDraft'

afterEach(() => {
  vi.restoreAllMocks()
})

const KEY = 'rascunho:teste'

describe('useDraft', () => {
  it('abre vazio quando não há rascunho', () => {
    const { result } = renderHook(() => useDraft('teste', ['name', 'email']))
    expect(result.current.initial).toEqual({ name: '', email: '' })
    expect(result.current.recovered).toBe(false)
  })

  it('devolve o que foi guardado e avisa que recuperou', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ name: 'Padaria Sol', email: 'a@b.co' }))
    const { result } = renderHook(() => useDraft('teste', ['name', 'email']))
    expect(result.current.initial).toEqual({ name: 'Padaria Sol', email: 'a@b.co' })
    expect(result.current.recovered).toBe(true)
  })

  it('ignora o que não é texto, campos que não existem e rascunhos em branco', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ name: 42, other: 'x', email: '  ' }))
    const { result } = renderHook(() => useDraft('teste', ['name', 'email']))
    expect(result.current.initial).toEqual({ name: '', email: '' })
    expect(result.current.recovered).toBe(false)
  })

  it('trata rascunho quebrado como se não houvesse', () => {
    sessionStorage.setItem(KEY, '{não é json')
    expect(renderHook(() => useDraft('teste', ['name'])).result.current.recovered).toBe(false)
    sessionStorage.setItem(KEY, '"texto"')
    expect(renderHook(() => useDraft('teste', ['name'])).result.current.recovered).toBe(false)
    sessionStorage.setItem(KEY, 'null')
    expect(renderHook(() => useDraft('teste', ['name'])).result.current.recovered).toBe(false)
  })

  it('"clear" apaga o rascunho e esconde o aviso', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ name: 'Padaria Sol' }))
    const { result } = renderHook(() => useDraft('teste', ['name']))
    act(() => {
      result.current.clear()
    })
    expect(result.current.recovered).toBe(false)
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })

  it('segue funcionando sem armazenamento (bloqueado ou cheio)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('cheio')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    const { result } = renderHook(() => {
      const draft = useDraft('teste', ['name'])
      useDraftSync('teste', { name: 'x' })
      return draft
    })
    expect(result.current.recovered).toBe(false)
    expect(() => {
      act(() => {
        result.current.clear()
      })
    }).not.toThrow()
  })
})

describe('useDraftSync', () => {
  it('guarda o que está escrito e apaga quando tudo fica vazio', () => {
    const { rerender } = renderHook(({ name }) => useDraftSync('teste', { name }), {
      initialProps: { name: 'Padaria Sol' },
    })
    expect(JSON.parse(sessionStorage.getItem(KEY) ?? 'null')).toEqual({ name: 'Padaria Sol' })
    rerender({ name: '   ' })
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })
})

describe('clearDrafts', () => {
  it('apaga só os rascunhos', () => {
    sessionStorage.setItem(KEY, JSON.stringify({ name: 'x' }))
    sessionStorage.setItem('rascunho:outro', JSON.stringify({ name: 'y' }))
    sessionStorage.setItem('tema', 'escuro')
    clearDrafts()
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(sessionStorage.getItem('rascunho:outro')).toBeNull()
    expect(sessionStorage.getItem('tema')).toBe('escuro')
  })

  it('não quebra sem armazenamento', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('bloqueado')
    })
    sessionStorage.setItem(KEY, JSON.stringify({ name: 'x' }))
    expect(() => {
      clearDrafts()
    }).not.toThrow()
  })
})

function Form() {
  const draft = useDraft('teste', ['name'])
  const [name, setName] = useState(draft.initial.name)
  useDraftSync('teste', { name })
  return (
    <form>
      <label>
        Nome
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value)
          }}
        />
      </label>
      {draft.recovered && (
        <DraftNotice
          onDiscard={() => {
            setName('')
            draft.clear()
          }}
        />
      )}
    </form>
  )
}

describe('um formulário com rascunho', () => {
  it('guarda o que a pessoa digita, devolve ao reabrir e deixa descartar', async () => {
    const user = userEvent.setup()
    const first = render(<Form />)
    await user.type(screen.getByLabelText('Nome'), 'Padaria')
    first.unmount()

    render(<Form />)
    expect(screen.getByLabelText('Nome')).toHaveValue('Padaria')
    expect(screen.getByText('Recuperamos o que você tinha digitado.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Descartar rascunho' }))
    expect(screen.getByLabelText('Nome')).toHaveValue('')
    expect(screen.queryByText('Recuperamos o que você tinha digitado.')).not.toBeInTheDocument()
    expect(sessionStorage.getItem(KEY)).toBeNull()
  })
})
