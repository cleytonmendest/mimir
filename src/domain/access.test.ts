import { describe, expect, it } from 'vitest'
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MAX_SUPPLIER_NAME_LENGTH,
  MIN_PASSWORD_LENGTH,
  formatInviteCode,
  isInviteCode,
  isPlausibleEmail,
  normalizeInviteCode,
  validateEmail,
  validateInviteCodeEntry,
  validateLoginPassword,
  validatePassword,
  validateSupplierInput,
  validateSupplierName,
} from './access'

describe('validatePassword', () => {
  it('aceita do mínimo ao máximo', () => {
    expect(validatePassword('x'.repeat(MIN_PASSWORD_LENGTH))).toBeNull()
    expect(validatePassword('x'.repeat(MAX_PASSWORD_LENGTH))).toBeNull()
  })

  it('recusa a curta', () => {
    expect(validatePassword('x'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe(
      'A senha precisa ter pelo menos 10 caracteres.',
    )
    expect(validatePassword('')).not.toBeNull()
  })

  it('recusa a que passa de 72 bytes, contando acentos pelos bytes', () => {
    expect(validatePassword('x'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe(
      'A senha pode ter até 72 caracteres.',
    )
    // 37 letras de 2 bytes = 74 bytes, ainda que só 37 caracteres.
    expect(validatePassword('é'.repeat(37))).not.toBeNull()
    expect(validatePassword('é'.repeat(36))).toBeNull()
  })
})

describe('isPlausibleEmail', () => {
  it.each(['ana@loja.com', 'a.b+c@sub.dominio.com.br'])('aceita %s', (email) => {
    expect(isPlausibleEmail(email)).toBe(true)
  })

  it.each(['', 'ana', 'ana@', '@loja.com', 'ana@loja', 'ana @loja.com', 'ana@lo ja.com'])(
    'recusa "%s"',
    (email) => {
      expect(isPlausibleEmail(email)).toBe(false)
    },
  )

  it('recusa e-mail maior que o permitido', () => {
    const long = `${'a'.repeat(MAX_EMAIL_LENGTH)}@loja.com`
    expect(isPlausibleEmail(long)).toBe(false)
  })
})

describe('conferência de cada campo', () => {
  it('nome: obrigatório, sem contar espaços, e com tamanho máximo', () => {
    expect(validateSupplierName('Sabor da Serra')).toBeNull()
    expect(validateSupplierName('  ')).toBe('Informe o nome do fornecedor.')
    expect(validateSupplierName('a'.repeat(MAX_SUPPLIER_NAME_LENGTH))).toBeNull()
    expect(validateSupplierName('a'.repeat(MAX_SUPPLIER_NAME_LENGTH + 1))).toBe(
      `O nome pode ter até ${MAX_SUPPLIER_NAME_LENGTH} caracteres.`,
    )
  })

  it('e-mail: obrigatório e com cara de e-mail; maiúsculas e espaços nas pontas não contam', () => {
    expect(validateEmail('  Ana@Exemplo.com ')).toBeNull()
    expect(validateEmail('')).toBe('Informe o e-mail.')
    expect(validateEmail('ana@')).toBe('Esse e-mail não parece certo. Confira e tente de novo.')
  })

  it('senha na entrada: só confere que existe', () => {
    expect(validateLoginPassword('x')).toBeNull()
    expect(validateLoginPassword('')).toBe('Informe a senha.')
  })

  it('código de convite: só confere que foi preenchido', () => {
    expect(validateInviteCodeEntry('K7QD-4MXA')).toBeNull()
    expect(validateInviteCodeEntry('  ')).toBe('Informe o código de convite.')
  })
})

describe('validateSupplierInput', () => {
  const ok = { email: 'ana@loja.com', fullName: 'Sabor da Serra' }

  it('aceita, tira espaços e põe o e-mail em minúsculas', () => {
    expect(
      validateSupplierInput({ email: '  Ana@Loja.COM ', fullName: '  Sabor da Serra  ' }),
    ).toEqual({ ok: true, value: { email: 'ana@loja.com', fullName: 'Sabor da Serra' } })
  })

  it('o nome é obrigatório e tem tamanho máximo', () => {
    expect(validateSupplierInput({ ...ok, fullName: '   ' })).toEqual({
      ok: false,
      message: 'Informe o nome do fornecedor.',
    })
    expect(
      validateSupplierInput({ ...ok, fullName: 'x'.repeat(MAX_SUPPLIER_NAME_LENGTH + 1) }),
    ).toEqual({ ok: false, message: 'O nome pode ter até 120 caracteres.' })
    expect(
      validateSupplierInput({ ...ok, fullName: 'x'.repeat(MAX_SUPPLIER_NAME_LENGTH) }).ok,
    ).toBe(true)
  })

  it('o e-mail é obrigatório e precisa parecer um e-mail', () => {
    expect(validateSupplierInput({ ...ok, email: '  ' })).toEqual({
      ok: false,
      message: 'Informe o e-mail.',
    })
    expect(validateSupplierInput({ ...ok, email: 'ana@loja' })).toEqual({
      ok: false,
      message: 'Esse e-mail não parece certo. Confira e tente de novo.',
    })
  })
})

describe('código de convite', () => {
  it('o alfabeto não tem os caracteres que se confundem', () => {
    for (const confusing of '01OI') expect(INVITE_CODE_ALPHABET).not.toContain(confusing)
    expect(INVITE_CODE_ALPHABET).toHaveLength(32)
  })

  it('normaliza o que a pessoa digita ou cola', () => {
    expect(normalizeInviteCode('k7qd-4mxa')).toBe('K7QD4MXA')
    expect(normalizeInviteCode(' K7QD 4MXA\n')).toBe('K7QD4MXA')
    expect(normalizeInviteCode('')).toBe('')
  })

  it('reconhece um código válido', () => {
    expect(isInviteCode('K7QD4MXA')).toBe(true)
    expect(isInviteCode('K7QD4MX')).toBe(false)
    expect(isInviteCode('K7QD4MXAA')).toBe(false)
    expect(isInviteCode('K7QD4MX0')).toBe(false)
    expect(isInviteCode('k7qd4mxa')).toBe(false)
  })

  it('formata em dois blocos para ler e ditar', () => {
    expect(formatInviteCode('K7QD4MXA')).toBe('K7QD-4MXA')
    expect(normalizeInviteCode(formatInviteCode('K7QD4MXA'))).toBe('K7QD4MXA')
    expect(INVITE_CODE_LENGTH).toBe(8)
  })

  it('o que não tem o tamanho de um código fica como está', () => {
    expect(formatInviteCode('K7')).toBe('K7')
    expect(formatInviteCode('')).toBe('')
  })
})
