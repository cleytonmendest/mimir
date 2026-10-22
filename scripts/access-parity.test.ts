import { describe, expect, it } from 'vitest'
import * as domain from '../src/domain/access.ts'
import * as functions from '../supabase/functions/_shared/validate.ts'

/**
 * As Edge Functions não podem importar de src/ (o deploy leva só supabase/functions), então as
 * regras de cadastro existem duas vezes. Este teste põe as duas lado a lado: se uma mudar sem a
 * outra, o app dirá "ok" para algo que a função recusa (ou o contrário).
 */
describe('regras de cadastro: app e Edge Functions decidem igual', () => {
  it('constantes', () => {
    expect({
      min: functions.MIN_PASSWORD_LENGTH,
      max: functions.MAX_PASSWORD_LENGTH,
      name: functions.MAX_SUPPLIER_NAME_LENGTH,
      email: functions.MAX_EMAIL_LENGTH,
      alphabet: functions.INVITE_CODE_ALPHABET,
      length: functions.INVITE_CODE_LENGTH,
    }).toEqual({
      min: domain.MIN_PASSWORD_LENGTH,
      max: domain.MAX_PASSWORD_LENGTH,
      name: domain.MAX_SUPPLIER_NAME_LENGTH,
      email: domain.MAX_EMAIL_LENGTH,
      alphabet: domain.INVITE_CODE_ALPHABET,
      length: domain.INVITE_CODE_LENGTH,
    })
  })

  const passwords = [
    '',
    'curta',
    'x'.repeat(9),
    'x'.repeat(10),
    'x'.repeat(72),
    'x'.repeat(73),
    'é'.repeat(36),
    'é'.repeat(37),
    '😀'.repeat(18),
    '😀'.repeat(19),
    '          ',
  ]
  it.each(passwords.map((password) => [password.slice(0, 12), password]))(
    'senha %j',
    (_label, password) => {
      expect(functions.validatePassword(password)).toBe(domain.validatePassword(password))
    },
  )

  const people = [
    { email: 'ana@loja.com', fullName: 'Ana' },
    { email: '  ANA@Loja.COM ', fullName: '  Ana  ' },
    { email: '', fullName: 'Ana' },
    { email: 'ana@loja', fullName: 'Ana' },
    { email: 'ana loja@x.com', fullName: 'Ana' },
    { email: 'ana@loja.com', fullName: '' },
    { email: 'ana@loja.com', fullName: '   ' },
    { email: 'ana@loja.com', fullName: 'x'.repeat(120) },
    { email: 'ana@loja.com', fullName: 'x'.repeat(121) },
    { email: `${'a'.repeat(250)}@x.com`, fullName: 'Ana' },
  ]
  it.each(people.map((person, index) => [index, person]))('fornecedor #%i', (_index, person) => {
    expect(functions.validateNameAndEmail(person)).toEqual(domain.validateSupplierInput(person))
  })

  it.each(['k7qd-4mxa', ' K7QD 4MXA\n', '', 'ábc-123', 'K7QD4MX0'])('código %j', (raw) => {
    expect(functions.normalizeInviteCode(raw)).toBe(domain.normalizeInviteCode(raw))
  })
})
