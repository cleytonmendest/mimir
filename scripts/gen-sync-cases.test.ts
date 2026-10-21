// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { generateSyncCasesSql, readCases, SQL_FILE, type SyncCase } from './gen-sync-cases.ts'

describe('pgTAP gerado dos casos compartilhados', () => {
  it('70_sync_cases.test.sql está atualizado (rode "npm run db:gen-cases")', () => {
    expect(readFileSync(SQL_FILE, 'utf8')).toBe(generateSyncCasesSql(readCases()))
  })

  it('um teste por caso, com o plano certo', () => {
    const cases = readCases()
    const sql = generateSyncCasesSql(cases)
    expect(sql).toContain(`select plan(${cases.length});`)
    expect(sql.match(/^select is\($/gm)).toHaveLength(cases.length)
  })

  it('o ator "other" envia como o outro repositor', () => {
    const base = readCases()[0] as SyncCase
    const sql = generateSyncCasesSql([{ ...base, actor: 'other' }])
    expect(sql).toContain("tests.run_case(1, '00000000-0000-0000-0000-0000000000b1'")
  })

  it('texto que não cabe em dollar-quoting é recusado em vez de gerar SQL quebrado', () => {
    const base = readCases()[0] as SyncCase
    expect(() => generateSyncCasesSql([{ ...base, name: 'quebra $q$ aqui' }])).toThrow(
      /dollar-quoting/,
    )
  })
})
