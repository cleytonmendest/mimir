import { describe, expect, it } from 'vitest'
import { parseSetActiveResult, parseSettingsResult, parseSignupMode } from './access-wire'
import { RequestFailure } from './errors'

describe('parseSetActiveResult', () => {
  it('desativou, com quantas reservas foram canceladas', () => {
    expect(parseSetActiveResult({ ok: true, active: false, cancelled: 2 })).toEqual({
      ok: true,
      active: false,
      cancelled: 2,
    })
  })

  it('recusas conhecidas e desconhecidas', () => {
    expect(parseSetActiveResult({ ok: false, code: 'FORBIDDEN' })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    })
    expect(parseSetActiveResult({ ok: false, code: 'NOT_FOUND' })).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    })
    expect(parseSetActiveResult({ ok: false, code: 'NOVA_REGRA' })).toEqual({
      ok: false,
      code: 'UNRECOGNIZED',
    })
  })

  it.each([
    null,
    'texto',
    [],
    {},
    { ok: 'sim' },
    { ok: false },
    { ok: true, active: 'não', cancelled: 0 },
    { ok: true, active: false, cancelled: -1 },
    { ok: true, active: false, cancelled: 1.5 },
  ])('resposta fora da forma é INVALID_RESPONSE: %j', (data) => {
    expect(() => parseSetActiveResult(data)).toThrow(RequestFailure)
  })
})

describe('parseSettingsResult', () => {
  it('modo e código', () => {
    expect(parseSettingsResult({ ok: true, mode: 'invite', invite_code: 'K7QD4MXA' })).toEqual({
      ok: true,
      settings: { mode: 'invite', inviteCode: 'K7QD4MXA' },
    })
    expect(parseSettingsResult({ ok: true, mode: 'closed', invite_code: null })).toEqual({
      ok: true,
      settings: { mode: 'closed', inviteCode: null },
    })
  })

  it('recusa', () => {
    expect(parseSettingsResult({ ok: false, code: 'FORBIDDEN' })).toEqual({
      ok: false,
      code: 'FORBIDDEN',
    })
    expect(parseSettingsResult({ ok: false, code: 'OUTRA' })).toEqual({
      ok: false,
      code: 'UNRECOGNIZED',
    })
  })

  it.each([
    { ok: true, mode: 'aberto', invite_code: null },
    { ok: true, mode: 'invite', invite_code: 7 },
    { ok: true, invite_code: null },
  ])('forma inesperada: %j', (data) => {
    expect(() => parseSettingsResult(data)).toThrow(RequestFailure)
  })
})

describe('parseSignupMode', () => {
  it('aceita os três modos e recusa o resto', () => {
    expect(['closed', 'invite', 'open'].map(parseSignupMode)).toEqual(['closed', 'invite', 'open'])
    expect(() => parseSignupMode('aberto')).toThrow(RequestFailure)
    expect(() => parseSignupMode(undefined)).toThrow(RequestFailure)
  })
})
