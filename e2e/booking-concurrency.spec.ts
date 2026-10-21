import { expect, test } from '@playwright/test'
import { companyDay } from './support/dates.ts'
import { cleanupBooking, createMarket, createSuppliers, seedUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'

/**
 * O defeito que o produto não pode ter: passar do limite de estandes quando vários fornecedores
 * reservam o mesmo dia ao mesmo tempo. Aqui são chamadas reais, em paralelo, ao Supabase local:
 * a trava por mercado e dia (book_slot_v1) e o trigger de guarda é que decidem.
 */

interface Body {
  ok: boolean
  code?: string
  already_booked?: boolean
}

test('10 fornecedores disputam as 3 vagas, em 5 dias seguidos: sempre exatamente 3 reservam', async () => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const { db, cleanup } = await seedUsers(supabase)
  const marketId = await createMarket(db, 3)
  const suppliers = await createSuppliers(supabase, db, 10)

  try {
    // Várias rodadas: uma corrida que passa por sorte de tempo não prova nada.
    for (const offset of [5, 6, 7, 8, 9]) {
      const day = companyDay(offset)
      const results = await Promise.all(
        suppliers.map((supplier) =>
          supplier.client.rpc('book_slot_v1', { p_market: marketId, p_day: day }),
        ),
      )
      const bodies = results.map((result) => {
        expect(result.error).toBeNull()
        return result.data as unknown as Body
      })

      expect(bodies.filter((body) => body.ok)).toHaveLength(3)
      expect(bodies.filter((body) => !body.ok && body.code === 'FULL')).toHaveLength(7)

      const stored = await db
        .from('bookings')
        .select('supplier_id')
        .eq('market_id', marketId)
        .eq('day', day)
        .is('cancelled_at', null)
      expect(stored.data).toHaveLength(3)
    }
  } finally {
    await cleanupBooking(db, marketId, suppliers)
    await cleanup()
  }
})

test('com limite 1, 10 fornecedores ao mesmo tempo: só um reserva', async () => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const { db, cleanup } = await seedUsers(supabase)
  const marketId = await createMarket(db, 1)
  const suppliers = await createSuppliers(supabase, db, 10)
  const day = companyDay(2)

  try {
    const results = await Promise.all(
      suppliers.map((supplier) =>
        supplier.client.rpc('book_slot_v1', { p_market: marketId, p_day: day }),
      ),
    )
    const bodies = results.map((result) => result.data as unknown as Body)
    expect(bodies.filter((body) => body.ok)).toHaveLength(1)

    const stored = await db
      .from('bookings')
      .select('id')
      .eq('market_id', marketId)
      .eq('day', day)
      .is('cancelled_at', null)
    expect(stored.data).toHaveLength(1)
  } finally {
    await cleanupBooking(db, marketId, suppliers)
    await cleanup()
  }
})

test('o mesmo fornecedor clicando 10 vezes ao mesmo tempo gera uma reserva só', async () => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const { db, cleanup } = await seedUsers(supabase)
  const marketId = await createMarket(db, 3)
  const [supplier] = await createSuppliers(supabase, db, 1)
  if (supplier === undefined) throw new Error('fornecedor não foi criado')
  const day = companyDay(7)

  try {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        supplier.client.rpc('book_slot_v1', { p_market: marketId, p_day: day }),
      ),
    )
    const bodies = results.map((result) => result.data as unknown as Body)

    // Todas dizem "ok" (repetir é seguro), mas só uma criou a reserva.
    expect(bodies.every((body) => body.ok)).toBe(true)
    expect(bodies.filter((body) => body.already_booked === false)).toHaveLength(1)

    const stored = await db.from('bookings').select('id').eq('market_id', marketId)
    expect(stored.data).toHaveLength(1)
  } finally {
    await cleanupBooking(db, marketId, [supplier])
    await cleanup()
  }
})

test('cancelar e reservar ao mesmo tempo nunca passa do limite', async () => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const { db, cleanup } = await seedUsers(supabase)
  const marketId = await createMarket(db, 2)
  const suppliers = await createSuppliers(supabase, db, 6)
  const day = companyDay(4)

  try {
    // Dois já reservaram (dia cheio) e depois todos disputam enquanto os dois primeiros cancelam.
    const [first, second, ...others] = suppliers
    if (first === undefined || second === undefined) throw new Error('faltam fornecedores')
    const booked = await Promise.all(
      [first, second].map((supplier) =>
        supplier.client.rpc('book_slot_v1', { p_market: marketId, p_day: day }),
      ),
    )
    const ids = booked.map(
      (result) => (result.data as unknown as { booking_id: string }).booking_id,
    )

    await Promise.all([
      ...others.map((supplier) =>
        supplier.client.rpc('book_slot_v1', { p_market: marketId, p_day: day }),
      ),
      first.client.rpc('cancel_booking_v1', { p_booking: ids[0] as string }),
      second.client.rpc('cancel_booking_v1', { p_booking: ids[1] as string }),
    ])

    const stored = await db
      .from('bookings')
      .select('id')
      .eq('market_id', marketId)
      .eq('day', day)
      .is('cancelled_at', null)
    expect((stored.data ?? []).length).toBeLessThanOrEqual(2)
  } finally {
    await cleanupBooking(db, marketId, suppliers)
    await cleanup()
  }
})
