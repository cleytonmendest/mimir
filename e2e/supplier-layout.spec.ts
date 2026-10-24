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

    // Só com o teclado: a confirmação diz qual reserva vai embora e leva o foco a "Manter";
    // Esc desiste e o foco volta ao botão que a abriu (antes, caía na página).
    const cancel = mine.getByRole('button', { name: 'Cancelar reserva' })
    await cancel.focus()
    await page.keyboard.press('Enter')
    const confirm = mine.getByRole('group', { name: 'Confirmar cancelamento' })
    await expect(confirm).toContainText(`Cancelar a reserva de`)
    await expect(confirm).toContainText(market.name)
    await expect(confirm.getByRole('button', { name: 'Manter' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(confirm).toHaveCount(0)
    await expect(cancel).toBeFocused()
  } finally {
    await cleanupBooking(seed.db, market.id, [supplier])
    await seed.cleanup()
  }
})

test('os dias do calendário têm pelo menos 44 px de largura num celular de 360 px', async ({
  page,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const market = await createMarket(seed.db, 3, 'Mercado E2E dias do calendário')

  try {
    await page.setViewportSize({ width: 360, height: 800 })
    await signIn(page, seed.supplier.email, seed.supplier.password)
    await page.getByRole('heading', { name: /^\w+ de \d{4}$/ }).waitFor()
    type Box = { getBoundingClientRect: () => { width: number } }
    const widths = await page
      .locator('button[data-status]')
      .evaluateAll((cells) =>
        (cells as unknown as Box[]).map((cell) => cell.getBoundingClientRect().width),
      )
    expect(widths.length).toBeGreaterThanOrEqual(28)
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(44)
    // A página não ganha rolagem lateral por causa disso.
    const fits = await page.evaluate(() => {
      const root = (
        globalThis as unknown as {
          document: { documentElement: { scrollWidth: number; clientWidth: number } }
        }
      ).document.documentElement
      return root.scrollWidth <= root.clientWidth
    })
    expect(fits).toBe(true)
  } finally {
    await seed.db.from('markets').delete().eq('id', market.id)
    await seed.cleanup()
  }
})
