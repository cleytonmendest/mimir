import { describe, expect, it } from 'vitest'
import { activationLink, inviteLink, resolveRoute } from './routes'

const at = (pathname: string, search = '') => resolveRoute({ pathname, search })

describe('resolveRoute', () => {
  it('a raiz e qualquer endereço desconhecido caem na tela principal', () => {
    expect(at('/')).toEqual({ page: 'home' })
    expect(at('/qualquer-coisa')).toEqual({ page: 'home' })
    expect(at('/definir-senha-extra')).toEqual({ page: 'home' })
  })

  it('o link de ativação traz o token', () => {
    expect(at('/definir-senha', '?token=abc123')).toEqual({ page: 'activation', token: 'abc123' })
    expect(at('/definir-senha/', '?token=abc123')).toEqual({ page: 'activation', token: 'abc123' })
  })

  it('link de ativação cortado fica sem token', () => {
    expect(at('/definir-senha')).toEqual({ page: 'activation', token: null })
    expect(at('/definir-senha', '?token=')).toEqual({ page: 'activation', token: null })
  })

  it('a página de cadastro lê o código do convite, em qualquer formato', () => {
    expect(at('/cadastro')).toEqual({ page: 'signup', code: '' })
    expect(at('/cadastro', '?codigo=K7QD-4MXA')).toEqual({ page: 'signup', code: 'K7QD4MXA' })
    expect(at('/cadastro/', '?codigo=k7qd%204mxa')).toEqual({ page: 'signup', code: 'K7QD4MXA' })
  })
})

describe('links', () => {
  it('o de ativação protege o token na URL', () => {
    expect(activationLink('https://agenda.exemplo', 'a+b/c=')).toBe(
      'https://agenda.exemplo/definir-senha?token=a%2Bb%2Fc%3D',
    )
  })

  it('o de convite leva o código em dois blocos', () => {
    expect(inviteLink('https://agenda.exemplo', 'K7QD4MXA')).toBe(
      'https://agenda.exemplo/cadastro?codigo=K7QD-4MXA',
    )
  })

  it('ida e volta: o que o administrador envia, a página entende', () => {
    const url = new URL(inviteLink('https://agenda.exemplo', 'K7QD4MXA'))
    expect(resolveRoute({ pathname: url.pathname, search: url.search })).toEqual({
      page: 'signup',
      code: 'K7QD4MXA',
    })
    const activation = new URL(activationLink('https://agenda.exemplo', 'a+b/c='))
    expect(resolveRoute({ pathname: activation.pathname, search: activation.search })).toEqual({
      page: 'activation',
      token: 'a+b/c=',
    })
  })
})
