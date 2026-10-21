import { describe, expect, it } from 'vitest'
import { COMPANY_TIME_ZONE } from './dates'
import { SYNC_REJECTION_CODES } from './sync'
import { ROLES, VISIT_ORIGINS, VISIT_STATUSES, type StandardRouteEntry, type Visit } from './types'

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

function enumValues(typeName: string): string[] {
  const create = new RegExp(`create type public\\.${typeName} as enum \\(([^)]*)\\)`).exec(sql)
  const values = [...(create?.[1] ?? '').matchAll(/'([^']+)'/g)].map((match) => match[1] ?? '')
  const added = [
    ...sql.matchAll(
      new RegExp(`alter type public\\.${typeName} add value (?:if not exists )?'([^']+)'`, 'g'),
    ),
  ].map((match) => match[1] ?? '')
  return [...values, ...added]
}

function tableColumns(table: string): string[] {
  const create = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)
  const defined = (create?.[1] ?? '')
    .split('\n')
    .map((line) => /^ {2}(\w+)\s/.exec(line)?.[1])
    .filter(
      (column): column is string =>
        column !== undefined && !/^(constraint|unique|primary|check|foreign)$/.test(column),
    )
  const added = [
    ...sql.matchAll(
      new RegExp(`alter table public\\.${table} add column (?:if not exists )?(\\w+)`, 'g'),
    ),
  ].map((match) => match[1] ?? '')
  return [...defined, ...added]
}

// Record<keyof ...> obriga a mapear campo novo do domínio (erro de compilação se faltar).
const VISIT_COLUMNS: Record<keyof Visit, string> = {
  id: 'id',
  repositorId: 'repositor_id',
  marketId: 'market_id',
  date: 'visit_date',
  order: 'position',
  status: 'status',
  origin: 'origin',
  carriedFromDate: 'carried_from_date',
  checkInAt: 'check_in_at',
  checkOutAt: 'check_out_at',
  note: 'note',
  skipReason: 'skip_reason',
}

const ROUTE_COLUMNS: Record<keyof StandardRouteEntry, string> = {
  repositorId: 'repositor_id',
  weekday: 'weekday',
  marketId: 'market_id',
  order: 'position',
}

describe('domínio ↔ banco', () => {
  it('as migrations foram encontradas', () => {
    expect(Object.keys(migrationFiles).length).toBeGreaterThan(0)
  })

  it.each([
    ['visit_status', VISIT_STATUSES],
    ['visit_origin', VISIT_ORIGINS],
    ['user_role', ROLES],
  ])('o enum %s tem os mesmos valores do domínio', (typeName, domainValues) => {
    expect(enumValues(typeName).sort()).toEqual([...domainValues].sort())
  })

  it('todo campo de Visit tem coluna em public.visits', () => {
    const columns = tableColumns('visits')
    for (const column of Object.values(VISIT_COLUMNS)) expect(columns).toContain(column)
  })

  it('todo campo da rota padrão tem coluna em public.standard_route', () => {
    const columns = tableColumns('standard_route')
    for (const column of Object.values(ROUTE_COLUMNS)) expect(columns).toContain(column)
  })

  it.each(SYNC_REJECTION_CODES)('a função de sincronização sabe devolver %s', (code) => {
    const body = /create function public\.apply_visit_event\([^)]*\)[\s\S]*?\n\$\$;/.exec(sql)
    const caller = /create function public\.sync_visit_events_v1\([^)]*\)[\s\S]*?\n\$\$;/.exec(sql)
    expect(`${body?.[0]}${caller?.[0]}`).toContain(`'${code}'`)
  })

  it('o fuso da empresa é o mesmo no domínio e em public.company_date()', () => {
    const body = /create function public\.company_date\([^)]*\)[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)
    expect(body?.[1]).toContain(`at time zone '${COMPANY_TIME_ZONE}'`)
  })
})
