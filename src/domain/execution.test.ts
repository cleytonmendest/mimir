import { describe, expect, it } from 'vitest'
import { NO_CHECKOUT_REASON } from './carryover'
import { DomainError } from './errors'
import { AUTO_CHECKOUT_NOTE, checkIn } from './execution'
import { ana, bruno, deepFreeze, makeVisit } from './testing'

const TODAY = '2026-10-20'
const NOW = '2026-10-20T12:00:00.000Z'
const ctx = { actor: ana, now: NOW, today: TODAY }

describe('check-in com um mercado aberto por vez', () => {
  it('sem outra visita aberta, só a nova muda', () => {
    const visits = deepFreeze([makeVisit({ id: 'a', date: TODAY })])
    const changed = checkIn(visits, 'a', ctx)
    expect(changed).toHaveLength(1)
    expect(changed[0]).toMatchObject({ status: 'in_progress', checkInAt: NOW })
  })

  it('encerra a anterior do mesmo dia como feita, com check-out na hora do novo check-in', () => {
    const visits = deepFreeze([
      makeVisit({
        id: 'old',
        marketId: 'm1',
        date: TODAY,
        status: 'in_progress',
        checkInAt: '2026-10-20T09:00:00.000Z',
      }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ])
    const changed = checkIn(visits, 'new', ctx)
    expect(changed.map((visit) => visit.id)).toEqual(['new', 'old'])
    expect(changed[1]).toMatchObject({ status: 'done', checkOutAt: NOW, note: AUTO_CHECKOUT_NOTE })
  })

  it('mantém a observação que o repositor já tinha escrito', () => {
    const visits = [
      makeVisit({
        id: 'old',
        marketId: 'm1',
        date: TODAY,
        status: 'in_progress',
        checkInAt: '2026-10-20T09:00:00.000Z',
        note: 'Faltou leite',
      }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ]
    expect(checkIn(visits, 'new', ctx)[1]?.note).toBe('Faltou leite')
  })

  it('a anterior de um dia que já passou vira "não foi", não "feita"', () => {
    const visits = [
      makeVisit({
        id: 'old',
        marketId: 'm1',
        date: '2026-10-19',
        status: 'in_progress',
        checkInAt: '2026-10-19T09:00:00.000Z',
      }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ]
    expect(checkIn(visits, 'new', ctx)[1]).toMatchObject({
      status: 'not_done',
      skipReason: NO_CHECKOUT_REASON,
    })
  })

  it('o check-out automático nunca fica antes do check-in (relógio offline atrasado)', () => {
    const checkInAt = '2026-10-20T15:00:00.000Z'
    const visits = [
      makeVisit({ id: 'old', marketId: 'm1', date: TODAY, status: 'in_progress', checkInAt }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ]
    expect(checkIn(visits, 'new', ctx)[1]?.checkOutAt).toBe(checkInAt)
  })

  it('in_progress sem hora de check-in (dado corrompido) ainda fecha de forma consistente', () => {
    const visits = [
      makeVisit({ id: 'old', marketId: 'm1', date: TODAY, status: 'in_progress', checkInAt: null }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ]
    expect(checkIn(visits, 'new', ctx)[1]).toMatchObject({ checkInAt: NOW, checkOutAt: NOW })
  })

  it('não mexe nas visitas abertas de outro repositor', () => {
    const visits = [
      makeVisit({
        id: 'other',
        repositorId: bruno.id,
        marketId: 'm1',
        date: TODAY,
        status: 'in_progress',
        checkInAt: NOW,
      }),
      makeVisit({ id: 'new', marketId: 'm2', date: TODAY }),
    ]
    expect(checkIn(visits, 'new', ctx).map((visit) => visit.id)).toEqual(['new'])
  })

  it('check-in inválido não encerra nada: ou muda tudo ou não muda nada', () => {
    const visits = [
      makeVisit({ id: 'old', marketId: 'm1', date: TODAY, status: 'in_progress', checkInAt: NOW }),
      makeVisit({ id: 'future', marketId: 'm2', date: '2026-10-21' }),
    ]
    expect(() => checkIn(visits, 'future', ctx)).toThrow(DomainError)
  })

  it('visita que não existe', () => {
    expect(() => checkIn([], 'nada', ctx)).toThrow(/não existe/)
  })
})
