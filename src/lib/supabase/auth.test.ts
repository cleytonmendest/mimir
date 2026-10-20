import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthFailure, createAuthGateway } from './auth'
import type { AppSupabaseClient } from './client'
import { ConfigError } from './errors'

/** Só o que o gateway usa do cliente de auth. */
function gatewayWith(auth: Record<string, unknown>) {
  return createAuthGateway(() => ({ auth }) as unknown as AppSupabaseClient)
}

afterEach(() => {
  vi.useRealTimers()
})

describe('signIn', () => {
  it('entra com e-mail e senha', async () => {
    const signInWithPassword = vi.fn().mockResolvedValue({ data: {}, error: null })

    await gatewayWith({ signInWithPassword }).signIn('ana@test.dev', 'segredo')

    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'ana@test.dev', password: 'segredo' })
  })

  it.each([
    [
      'credenciais erradas',
      new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'),
      'INVALID_CREDENTIALS',
    ],
    ['falta de internet', new AuthRetryableFetchError('fetch failed', 0), 'NETWORK'],
    ['qualquer outra falha', new AuthApiError('Database error', 500, 'unexpected_failure'), 'UNKNOWN'],
  ])('%s vira AuthFailure com o código certo', async (_name, error, code) => {
    const signInWithPassword = vi.fn().mockResolvedValue({ data: {}, error })

    const failure = await gatewayWith({ signInWithPassword })
      .signIn('ana@test.dev', 'x')
      .catch((caught: unknown) => caught)

    expect(failure).toBeInstanceOf(AuthFailure)
    expect(failure).toMatchObject({ code, cause: error })
  })

  it('sem configuração do Supabase a falha é de configuração, não de login', async () => {
    const gateway = createAuthGateway(() => {
      throw new ConfigError('faltam as variáveis')
    })

    await expect(gateway.signIn('a@b.c', 'x')).rejects.toBeInstanceOf(ConfigError)
  })
})

describe('signOut', () => {
  it('sai só deste aparelho (escopo local), sem derrubar o login em outros', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: null })

    await gatewayWith({ signOut }).signOut()

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('sem internet o SDK avisa o erro mas apaga a sessão do aparelho: para quem saiu, deu certo', async () => {
    const signOut = vi
      .fn()
      .mockResolvedValue({ error: new AuthRetryableFetchError('fetch failed', 0) })
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null })

    await expect(gatewayWith({ signOut, getSession }).signOut()).resolves.toBeUndefined()
  })

  it('se a sessão continua no aparelho depois do erro, sair falhou de verdade', async () => {
    const signOut = vi.fn().mockResolvedValue({ error: new Error('boom') })
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { user: { id: 'u-ana' } } },
      error: null,
    })

    await expect(gatewayWith({ signOut, getSession }).signOut()).rejects.toMatchObject({
      name: 'AuthFailure',
      code: 'UNKNOWN',
    })
  })
})

describe('currentUserId', () => {
  it('devolve o usuário da sessão guardada no aparelho', async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { user: { id: 'u-ana' } } },
      error: null,
    })
    expect(await gatewayWith({ getSession }).currentUserId()).toBe('u-ana')
  })

  it('sem sessão devolve null', async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null })
    expect(await gatewayWith({ getSession }).currentUserId()).toBeNull()
  })

  it('erro ao ler a sessão vira AuthFailure', async () => {
    const getSession = vi.fn().mockResolvedValue({ data: { session: null }, error: new Error('x') })
    await expect(gatewayWith({ getSession }).currentUserId()).rejects.toBeInstanceOf(AuthFailure)
  })
})

describe('subscribe', () => {
  function subscribable() {
    const unsubscribe = vi.fn()
    let emit: (event: string, session: { user: { id: string } } | null) => void = () => undefined
    const onAuthStateChange = vi.fn((callback: typeof emit) => {
      emit = callback
      return { data: { subscription: { unsubscribe } } }
    })
    return { onAuthStateChange, unsubscribe, emit: (...args: Parameters<typeof emit>) => emit(...args) }
  }

  it('avisa quem entrou ou saiu, adiando o aviso para fora do lock do SDK', () => {
    vi.useFakeTimers()
    const { onAuthStateChange, emit } = subscribable()
    const listener = vi.fn()
    gatewayWith({ onAuthStateChange }).subscribe(listener)

    emit('SIGNED_IN', { user: { id: 'u-ana' } })
    expect(listener).not.toHaveBeenCalled()
    vi.runAllTimers()
    expect(listener).toHaveBeenLastCalledWith('u-ana')

    emit('SIGNED_OUT', null)
    vi.runAllTimers()
    expect(listener).toHaveBeenLastCalledWith(null)
  })

  it('a função devolvida cancela o aviso', () => {
    const { onAuthStateChange, unsubscribe } = subscribable()

    const cancel = gatewayWith({ onAuthStateChange }).subscribe(vi.fn())
    cancel()

    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('sem configuração do Supabase não há o que ouvir, e cancelar é inofensivo', () => {
    const gateway = createAuthGateway(() => {
      throw new ConfigError('faltam as variáveis')
    })

    expect(() => gateway.subscribe(vi.fn())()).not.toThrow()
  })

  it('erro que não é de configuração não é engolido', () => {
    const gateway = createAuthGateway(() => {
      throw new Error('inesperado')
    })

    expect(() => gateway.subscribe(vi.fn())).toThrow('inesperado')
  })
})
