import { expect, test } from '@playwright/test'
import { companyDay } from './support/dates.ts'
import { cleanupBooking, createMarket, createSuppliers, seedUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'
import { signIn } from './support/ui.ts'

/**
 * A tela do fornecedor com dezenas de lojas, no celular: a lista não estica a página, e as reservas
 * dele (e o botão de cancelar) ficam no topo, à vista, em vez de no fim de tudo.
 */

test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' })

test('com dezenas de lojas a lista rola por dentro e não estica a página', async ({ page }) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const ids: string[] = []
  for (let index = 0; index < 14; index += 1) {
    ids.push((await createMarket(seed.db, 3, `Loja de teste ${index}`)).id)
  }

  try {
    await signIn(page, seed.supplier.email, seed.supplier.password)
    const picker = page.getByRole('region', { name: 'Mercados' })
    const list = picker.getByRole('list')
    await expect(list).toBeVisible()

    const viewport = page.viewportSize()
    const box = await list.boundingBox()
    if (viewport === null || box === null) throw new Error('sem medidas da tela')
    // A lista ocupa no máximo cerca de metade da tela, e o que sobra rola dentro dela.
    expect(box.height).toBeLessThanOrEqual(viewport.height * 0.6)
    const scrolls = await list.evaluate((element) => {
      const { scrollHeight, clientHeight } = element as unknown as {
        scrollHeight: number
        clientHeight: number
      }
      return scrollHeight > clientHeight
    })
    expect(scrolls).toBe(true)
  } finally {
    await seed.db.from('markets').delete().in('id', ids)
    await seed.cleanup()
  }
})

test('as reservas do fornecedor vêm antes da lista de mercados, com o cancelar à vista', async ({
  page,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const market = await createMarket(seed.db, 3, 'Mercado E2E reservas no topo')
  const [supplier] = await createSuppliers(supabase, seed.db, 1)
  if (supplier === undefined) throw new Error('falta fornecedor')

  try {
    const booked = await supplier.client.rpc('book_slot_v1', {
      p_market: market.id,
      p_day: companyDay(1),
    })
    expect(booked.error).toBeNull()

    await signIn(page, supplier.email, supplier.password)
    const mine = page.getByRole('region', { name: 'Minhas reservas' })
    const markets = page.getByRole('region', { name: 'Mercados' })
    await expect(mine).toBeVisible()

    const mineBox = await mine.boundingBox()
    const marketsBox = await markets.boundingBox()
    if (mineBox === null || marketsBox === null) throw new Error('sem medidas da tela')
    expect(mineBox.y).toBeLessThan(marketsBox.y)
    await expect(mine.getByRole('button', { name: 'Cancelar reserva' })).toBeInViewport()
  } finally {
    await cleanupBooking(seed.db, market.id, [supplier])
    await seed.cleanup()
  }
})
