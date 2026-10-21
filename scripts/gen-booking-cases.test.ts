// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  expectedJson,
  generateBookingCasesSql,
  readCases,
  SQL_FILE,
  type BookingCase,
} from './gen-booking-cases.ts'

describe('pgTAP gerado dos casos compartilhados de reserva', () => {
  it('70_booking_cases.test.sql está atualizado (rode "npm run db:gen-cases")', () => {
    expect(readFileSync(SQL_FILE, 'utf8')).toBe(generateBookingCasesSql(readCases()))
  })

  it('um teste por caso, com o plano certo', () => {
    const cases = readCases()
    const sql = generateBookingCasesSql(cases)
    expect(sql).toContain(`select plan(${cases.length});`)
    expect(sql.match(/^select ok\($/gm)).toHaveLength(cases.length)
  })

  it('o esperado vira o JSON que a função devolve', () => {
    expect(expectedJson({ ok: true, alreadyBooked: true })).toBe(
      '{"ok":true,"already_booked":true}',
    )
    expect(expectedJson({ ok: false, code: 'FULL' })).toBe('{"ok":false,"code":"FULL"}')
  })

  it('texto que não cabe em dollar-quoting é recusado em vez de gerar SQL quebrado', () => {
    const base = readCases()[0] as BookingCase
    expect(() => generateBookingCasesSql([{ ...base, name: 'quebra $q$ aqui' }])).toThrow(
      /dollar-quoting/,
    )
  })
})
