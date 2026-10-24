import { describe, expect, it } from 'vitest'
import {
  busiestDay,
  MAX_ADDRESS_LENGTH,
  MAX_NAME_LENGTH,
  validateMarketAddress,
  validateMarketInput,
  validateMarketName,
} from './market'

const ok = { name: 'Mercado Central', address: 'Rua 1, 100', capacity: 3 }

describe('validateMarketName e validateMarketAddress (conferência de cada campo)', () => {
  it('o nome é obrigatório, sem contar espaços, e tem tamanho máximo', () => {
    expect(validateMarketName('Loja 07 - Leblon')).toBeNull()
    expect(validateMarketName('   ')).toBe('Informe o nome do mercado.')
    expect(validateMarketName('a'.repeat(MAX_NAME_LENGTH))).toBeNull()
    expect(validateMarketName('a'.repeat(MAX_NAME_LENGTH + 1))).toBe(
      `O nome pode ter até ${MAX_NAME_LENGTH} caracteres.`,
    )
  })

  it('o endereço é opcional e só tem tamanho máximo', () => {
    expect(validateMarketAddress('')).toBeNull()
    expect(validateMarketAddress('a'.repeat(MAX_ADDRESS_LENGTH))).toBeNull()
    expect(validateMarketAddress('a'.repeat(MAX_ADDRESS_LENGTH + 1))).toBe(
      `O endereço pode ter até ${MAX_ADDRESS_LENGTH} caracteres.`,
    )
  })
})

describe('validateMarketInput', () => {
  it('aceita e tira os espaços das pontas', () => {
    expect(
      validateMarketInput({ ...ok, name: '  Mercado Central  ', address: ' Rua 1, 100 ' }),
    ).toEqual({
      ok: true,
      value: { name: 'Mercado Central', address: 'Rua 1, 100', capacity: 3 },
    })
  })

  it('endereço vazio vira "sem endereço"', () => {
    expect(validateMarketInput({ ...ok, address: '   ' })).toEqual({
      ok: true,
      value: { name: 'Mercado Central', address: null, capacity: 3 },
    })
  })

  it('o nome é obrigatório e tem tamanho máximo', () => {
    expect(validateMarketInput({ ...ok, name: '   ' })).toEqual({
      ok: false,
      message: 'Informe o nome do mercado.',
    })
    expect(validateMarketInput({ ...ok, name: 'x'.repeat(MAX_NAME_LENGTH + 1) })).toMatchObject({
      ok: false,
      message: 'O nome pode ter até 100 caracteres.',
    })
    expect(validateMarketInput({ ...ok, name: 'x'.repeat(MAX_NAME_LENGTH) }).ok).toBe(true)
  })

  it('o endereço tem tamanho máximo', () => {
    expect(
      validateMarketInput({ ...ok, address: 'x'.repeat(MAX_ADDRESS_LENGTH + 1) }),
    ).toMatchObject({
      ok: false,
      message: 'O endereço pode ter até 200 caracteres.',
    })
  })

  it.each([0, 21, -1, 2.5, Number.NaN])('o limite %s não vale', (capacity) => {
    expect(validateMarketInput({ ...ok, capacity })).toEqual({
      ok: false,
      message: 'O limite deve ser um número de 1 a 20 estandes por dia.',
    })
  })

  it.each([1, 20])('o limite %s vale', (capacity) => {
    expect(validateMarketInput({ ...ok, capacity }).ok).toBe(true)
  })
})

describe('busiestDay', () => {
  const count = (day: string, booked: number) => ({ day, booked })

  it('sem reservas não há dia mais cheio', () => {
    expect(busiestDay([])).toBeNull()
    expect(busiestDay([count('2026-10-24', 0), count('2026-10-25', 0)])).toBeNull()
  })

  it('o dia com mais reservas, e o mais cedo se empatar', () => {
    expect(
      busiestDay([count('2026-10-23', 1), count('2026-10-24', 2), count('2026-10-25', 1)]),
    ).toEqual({ day: '2026-10-24', count: 2 })
    expect(busiestDay([count('2026-10-25', 1), count('2026-10-24', 1)])).toEqual({
      day: '2026-10-24',
      count: 1,
    })
    expect(busiestDay([count('2026-10-24', 1), count('2026-10-25', 1)])).toEqual({
      day: '2026-10-24',
      count: 1,
    })
  })

  it('ignora dias sem reserva no meio', () => {
    expect(busiestDay([count('2026-10-23', 0), count('2026-10-24', 3)])).toEqual({
      day: '2026-10-24',
      count: 3,
    })
  })
})
