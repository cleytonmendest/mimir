import { describe, expect, it } from 'vitest'
import type { Tables } from '@/lib/database.types'
import { marketFromRow, profileFromRow } from './mappers'

describe('marketFromRow', () => {
  const row: Tables<'markets'> = {
    id: 'm-a',
    name: 'Mercado A',
    address: null,
    archived_at: null,
    capacity: 3,
    created_at: '2026-10-20T09:00:00+00:00',
  }

  it('mercado ativo', () => {
    expect(marketFromRow(row)).toEqual({
      id: 'm-a',
      name: 'Mercado A',
      address: null,
      archived: false,
      capacity: 3,
    })
  })

  it('mercado arquivado', () => {
    expect(marketFromRow({ ...row, archived_at: '2026-10-21T00:00:00+00:00' }).archived).toBe(true)
  })
})

describe('profileFromRow', () => {
  it('vira um usuário com papel, que também serve de Actor do domínio', () => {
    const profile = profileFromRow({
      id: 'u-admin',
      role: 'admin',
      full_name: 'Lia',
      email: 'lia@loja.com',
      deactivated_at: null,
      created_at: '2026-10-20T09:00:00+00:00',
    })
    expect(profile).toEqual({ id: 'u-admin', role: 'admin', fullName: 'Lia', active: true })
  })

  it('conta desativada vira inativa', () => {
    const profile = profileFromRow({
      id: 'u-ana',
      role: 'supplier',
      full_name: 'Ana',
      email: 'ana@loja.com',
      deactivated_at: '2026-10-21T09:00:00+00:00',
      created_at: '2026-10-20T09:00:00+00:00',
    })
    expect(profile.active).toBe(false)
  })
})
