import { describe, expect, it } from 'vitest'
import { VISIT_STATUSES } from '@/domain/types'
import type { RejectedEvent } from '@/lib/offline/store'
import type { RejectionCode } from '@/lib/supabase/sync-wire'
import { describeRejection } from './explain'

function rejected(
  type: 'checkIn' | 'checkOut' | 'markNotDone',
  code: RejectionCode,
  visitStatus: RejectedEvent['rejection']['visitStatus'] = null,
): RejectedEvent {
  const base = {
    clientEventId: 'e-1',
    seq: 1,
    visitId: 'v-1',
    occurredAt: '2026-10-21T12:00:00.000Z',
  }
  const event =
    type === 'markNotDone'
      ? { ...base, type, reason: 'x' }
      : type === 'checkOut'
        ? { ...base, type }
        : { ...base, type }
  return { event, rejection: { code, visitStatus, rejectedAt: '2026-10-21T15:00:00.000Z' } }
}

describe('describeRejection', () => {
  it('diz qual ação, em qual mercado e por quê', () => {
    expect(
      describeRejection(rejected('checkIn', 'INVALID_TRANSITION', 'cancelled'), 'Mercado A'),
    ).toBe('Check-in no Mercado A: a visita foi cancelada pelo líder.')
  })

  it('sem o nome do mercado, ainda explica', () => {
    expect(describeRejection(rejected('checkOut', 'FORBIDDEN'), undefined)).toBe(
      'Check-out: esta visita não é sua.',
    )
  })

  it.each(VISIT_STATUSES)('INVALID_TRANSITION com a visita "%s" fala em português', (status) => {
    const text = describeRejection(rejected('markNotDone', 'INVALID_TRANSITION', status), 'M')
    expect(text).toMatch(/^"Não fui" no M: a visita /)
    expect(text).not.toContain('_')
  })

  it('INVALID_TRANSITION sem saber o estado da visita não inventa um', () => {
    expect(describeRejection(rejected('checkIn', 'INVALID_TRANSITION'), 'M')).toBe(
      'Check-in no M: a visita não estava mais nesse ponto.',
    )
  })

  it.each<[RejectionCode, RegExp]>([
    ['VISIT_IN_FUTURE', /ainda não chegou.*hora do celular/],
    ['VISIT_IN_PAST', /já passou.*líder/],
    ['CHECKOUT_BEFORE_CHECKIN', /saída ficou antes/],
    ['REASON_REQUIRED', /por que não foi/],
    ['VISIT_NOT_FOUND', /não existe mais/],
    ['CLOCK_INVALID', /celular estava adiantada/],
    ['ID_CONFLICT', /Fale com o líder/],
    ['INVALID_DATA', /Fale com o líder/],
    ['UNRECOGNIZED', /Fale com o líder/],
  ])('%s', (code, expected) => {
    expect(describeRejection(rejected('checkIn', code), 'M')).toMatch(expected)
  })
})
