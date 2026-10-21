import { describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { DataError } from './errors'
import {
  executionPatch,
  marketFromRow,
  profileFromRow,
  routeEntryFromRow,
  visitFromRow,
  visitToInsertRow,
} from './mappers'

const visitRow: Tables<'visits'> = {
  id: 'v-1',
  repositor_id: 'u-ana',
  market_id: 'm-a',
  visit_date: '2026-10-21',
  position: 2,
  status: 'done',
  origin: 'carryover',
  carried_from_date: '2026-10-20',
  check_in_at: '2026-10-21T12:30:00.123456+00:00',
  check_out_at: '2026-10-21T13:10:00+00:00',
  note: 'Gôndola reposta',
  skip_reason: null,
  created_at: '2026-10-20T09:00:00+00:00',
  updated_at: '2026-10-21T13:10:00+00:00',
}

describe('visitFromRow', () => {
  it('converte os nomes do banco para os do domínio', () => {
    expect(visitFromRow(visitRow)).toEqual({
      id: 'v-1',
      repositorId: 'u-ana',
      marketId: 'm-a',
      date: '2026-10-21',
      order: 2,
      status: 'done',
      origin: 'carryover',
      carriedFromDate: '2026-10-20',
      checkInAt: '2026-10-21T12:30:00.123Z',
      checkOutAt: '2026-10-21T13:10:00.000Z',
      note: 'Gôndola reposta',
      skipReason: null,
    })
  })

  it('normaliza o horário do Postgres para ISO em UTC, em qualquer fuso de origem', () => {
    const row = { ...visitRow, check_in_at: '2026-10-21T09:30:00-03:00', check_out_at: null }
    const visit = visitFromRow(row)
    expect(visit.checkInAt).toBe('2026-10-21T12:30:00.000Z')
    expect(visit.checkOutAt).toBeNull()
  })

  it('visita sem check-in nem sobra mantém os campos nulos', () => {
    const visit = visitFromRow({
      ...visitRow,
      status: 'planned',
      origin: 'standard',
      carried_from_date: null,
      check_in_at: null,
      check_out_at: null,
      note: null,
    })
    expect(visit.checkInAt).toBeNull()
    expect(visit.carriedFromDate).toBeNull()
    expect(visit.note).toBeNull()
  })
})

describe('routeEntryFromRow', () => {
  const row: Tables<'standard_route'> = {
    id: 'r-1',
    repositor_id: 'u-ana',
    weekday: 3,
    market_id: 'm-a',
    position: 1,
    created_at: '2026-10-20T09:00:00+00:00',
  }

  it('converte a entrada da rota padrão', () => {
    expect(routeEntryFromRow(row)).toEqual({
      repositorId: 'u-ana',
      weekday: 3,
      marketId: 'm-a',
      order: 1,
    })
  })

  it.each([-1, 7, 2.5])('dia da semana %s é recusado, não repassado ao domínio', (weekday) => {
    expect(() => routeEntryFromRow({ ...row, weekday })).toThrow(DataError)
  })
})

describe('marketFromRow', () => {
  const row: Tables<'markets'> = {
    id: 'm-a',
    name: 'Mercado A',
    address: null,
    archived_at: null,
    created_at: '2026-10-20T09:00:00+00:00',
  }

  it('mercado ativo', () => {
    expect(marketFromRow(row)).toEqual({
      id: 'm-a',
      name: 'Mercado A',
      address: null,
      archived: false,
    })
  })

  it('mercado arquivado', () => {
    expect(marketFromRow({ ...row, archived_at: '2026-10-21T00:00:00+00:00' }).archived).toBe(true)
  })
})

describe('profileFromRow', () => {
  it('vira um usuário com papel, que também serve de Actor do domínio', () => {
    const profile = profileFromRow({
      id: 'u-leader',
      role: 'leader',
      full_name: 'Lia',
      created_at: '2026-10-20T09:00:00+00:00',
    })
    expect(profile).toEqual({ id: 'u-leader', role: 'leader', fullName: 'Lia' })
  })
})

describe('visitToInsertRow', () => {
  it('é o caminho de volta de visitFromRow: ida e volta devolve a mesma linha (sem as datas de controle)', () => {
    const visit = visitFromRow(visitRow)

    expect(visitToInsertRow(visit)).toEqual({
      id: 'v-1',
      repositor_id: 'u-ana',
      market_id: 'm-a',
      visit_date: '2026-10-21',
      position: 2,
      status: 'done',
      origin: 'carryover',
      carried_from_date: '2026-10-20',
      check_in_at: '2026-10-21T12:30:00.123Z',
      check_out_at: '2026-10-21T13:10:00.000Z',
      note: 'Gôndola reposta',
      skip_reason: null,
    })
  })
})

describe('executionPatch', () => {
  it('leva só o que a execução muda: nunca repositor, mercado, dia, ordem ou origem', () => {
    const visit = visitFromRow({ ...visitRow, status: 'not_done', skip_reason: 'Loja fechada' })

    expect(executionPatch(visit)).toEqual({
      status: 'not_done',
      check_in_at: '2026-10-21T12:30:00.123Z',
      check_out_at: '2026-10-21T13:10:00.000Z',
      note: 'Gôndola reposta',
      skip_reason: 'Loja fechada',
    })
  })
})
