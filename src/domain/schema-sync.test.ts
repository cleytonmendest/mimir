import { describe, expect, it } from 'vitest'
import {
  BOOKING_REFUSALS,
  BOOKING_WINDOW_DAYS,
  CANCEL_REFUSALS,
  MAX_CAPACITY,
  MIN_CAPACITY,
} from './booking'
import { COMPANY_TIME_ZONE } from './dates'
import { ROLES } from './types'

/**
 * Domínio e banco falam do mesmo modelo em dois lugares. Este teste lê as migrations
 * (sem precisar de banco) e quebra se um lado mudar sem o outro.
 */
const migrationFiles = import.meta.glob<string>('/supabase/migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const sql = Object.keys(migrationFiles)
  .sort()
  .map((file) => migrationFiles[file])
  .join('\n')

/** Vale a última definição do tipo: uma migration pode recriá-lo, com os valores novos. */
function enumValues(typeName: string): string[] {
  const creates = [
    ...sql.matchAll(new RegExp(`create type public\\.${typeName} as enum \\(([^)]*)\\)`, 'g')),
  ]
  const values = [...(creates.at(-1)?.[1] ?? '').matchAll(/'([^']+)'/g)].map(
    (match) => match[1] ?? '',
  )
  const added = [
    ...sql.matchAll(
      new RegExp(`alter type public\\.${typeName} add value (?:if not exists )?'([^']+)'`, 'g'),
    ),
  ].map((match) => match[1] ?? '')
  return [...values, ...added]
}

describe('domínio ↔ banco', () => {
  it('as migrations foram encontradas', () => {
    expect(Object.keys(migrationFiles).length).toBeGreaterThan(0)
  })

  it('o enum user_role tem os mesmos valores do domínio', () => {
    expect(enumValues('user_role').sort()).toEqual([...ROLES].sort())
  })

  it('o fuso da empresa é o mesmo no domínio e em public.company_date()', () => {
    const body = /create function public\.company_date\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)
    expect(body?.[1]).toContain(`at time zone '${COMPANY_TIME_ZONE}'`)
  })

  it('a janela de reserva é a mesma no domínio e em public.booking_window_days()', () => {
    const body =
      /create function public\.booking_window_days\(\)[\s\S]*?\$\$\s*select (\d+)\s*\$\$/.exec(sql)
    expect(Number(body?.[1])).toBe(BOOKING_WINDOW_DAYS)
  })

  it('o limite de estandes tem o mesmo mínimo e máximo no domínio e no banco', () => {
    const check = /markets_capacity_range check \(capacity between (\d+) and (\d+)\)/.exec(sql)
    expect([Number(check?.[1]), Number(check?.[2])]).toEqual([MIN_CAPACITY, MAX_CAPACITY])
  })

  it.each(BOOKING_REFUSALS)('book_slot_v1 sabe devolver %s', (code) => {
    const body = /create function public\.book_slot_v1\([^)]*\)[\s\S]*?\n\$\$;/.exec(sql)
    expect(body?.[0]).toContain(`booking_refusal('${code}')`)
  })

  it.each(CANCEL_REFUSALS)('cancel_booking_v1 sabe devolver %s', (code) => {
    const body = /create function public\.cancel_booking_v1\([^)]*\)[\s\S]*?\n\$\$;/.exec(sql)
    expect(body?.[0]).toContain(`booking_refusal('${code}')`)
  })
})
