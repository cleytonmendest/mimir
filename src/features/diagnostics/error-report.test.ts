import { describe, expect, it } from 'vitest'
import { RequestFailure } from '@/lib/supabase/errors'
import { buildErrorReport, describeError } from './error-report'

describe('describeError', () => {
  it('diz o tipo, o código e a mensagem', () => {
    expect(describeError(new RequestFailure('NETWORK', 'fetch failed'))).toBe(
      'RequestFailure NETWORK: fetch failed',
    )
  })

  it('erro comum não tem código', () => {
    expect(describeError(new TypeError('Failed to fetch'))).toBe('TypeError: Failed to fetch')
  })

  it('segue as causas, uma por linha', () => {
    const error = new RequestFailure('NETWORK', 'sem rede', {
      cause: new TypeError('Failed to fetch', { cause: new Error('ECONNRESET') }),
    })
    expect(describeError(error)).toBe(
      [
        'RequestFailure NETWORK: sem rede',
        'Causa: TypeError: Failed to fetch',
        'Causa: Error: ECONNRESET',
      ].join('\n'),
    )
  })

  it('para depois de poucas causas', () => {
    let error = new Error('fundo')
    for (let level = 0; level < 10; level += 1)
      error = new Error(`nível ${level}`, { cause: error })
    expect(describeError(error).split('\n')).toHaveLength(4)
  })

  it('texto solto vale como está; o resto vira "sem detalhes"', () => {
    expect(describeError('quebrou')).toBe('quebrou')
    expect(describeError({ qualquer: 'coisa' })).toBe('Erro sem detalhes')
    expect(describeError(undefined)).toBe('Erro sem detalhes')
  })

  it('uma causa que não é erro entra como texto', () => {
    expect(describeError(new Error('a', { cause: 'b' }))).toBe('Error: a\nCausa: b')
  })
})

describe('buildErrorReport', () => {
  const base = {
    message: 'Sem conexão com o servidor.',
    at: new Date('2026-10-24T19:30:12Z'),
    path: '/',
    version: '0.0.0+abc1234',
  }

  it('traz quando, onde, versão, o que a tela disse e o erro', () => {
    expect(buildErrorReport({ ...base, details: 'RequestFailure NETWORK: fetch failed' })).toBe(
      [
        'Detalhes do erro - Agenda de Degustações',
        'Quando: 2026-10-24T19:30:12.000Z',
        'Tela: /',
        'Versão: 0.0.0+abc1234',
        'O que a tela disse: Sem conexão com o servidor.',
        'RequestFailure NETWORK: fetch failed',
      ].join('\n'),
    )
  })

  it('sem lado técnico, não deixa linha vazia', () => {
    const report = buildErrorReport({ ...base, details: null })
    expect(report.split('\n')).toHaveLength(5)
    expect(report.endsWith('Sem conexão com o servidor.')).toBe(true)
  })
})
