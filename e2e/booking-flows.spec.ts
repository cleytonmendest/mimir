import { expect, test, type Browser, type Page } from '@playwright/test'
import { companyDay } from './support/dates.ts'
import { cleanupBooking, createMarket, createSuppliers, seedUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'
import { firstFreeDay, openMarket, signIn } from './support/ui.ts'

/**
 * Os fluxos de reserva que não podem quebrar, no navegador de verdade (celular simulado) e contra o
 * Supabase local: RLS, a função de reservar, a trava e a auditoria incluídas.
 */

test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' })

test('o fornecedor reserva um dia com vaga e cancela a reserva', async ({ page }) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const market = await createMarket(seed.db, 3, 'Mercado E2E')

  try {
    await signIn(page, seed.supplier.email, seed.supplier.password)
    await openMarket(page, market.name)

    // Escolhe o primeiro dia livre e reserva, com a confirmação.
    await firstFreeDay(page).click()
    await page.getByRole('button', { name: 'Reservar este dia' }).click()
    await page.getByRole('button', { name: 'Confirmar reserva' }).click()

    await expect(page.getByRole('status')).toContainText('Reserva confirmada')
    await expect(page.getByText('Você tem uma reserva neste dia.')).toBeVisible()
    const mine = page
      .getByRole('region', { name: 'Minhas reservas' })
      .or(page.locator('section', { has: page.getByRole('heading', { name: 'Minhas reservas' }) }))
    await expect(mine.getByRole('button', { name: /ver no calendário/ })).toBeVisible()

    // No banco: uma reserva ativa, do fornecedor, e a auditoria diz quem reservou.
    const stored = await seed.db
      .from('bookings')
      .select('id, supplier_id, cancelled_at')
      .eq('market_id', market.id)
    expect(stored.data).toHaveLength(1)
    expect(stored.data?.[0]).toMatchObject({
      supplier_id: seed.supplier.userId,
      cancelled_at: null,
    })
    const audit = await seed.db
      .from('audit_log')
      .select('actor_id, actor_role, action')
      .eq('table_name', 'bookings')
      .eq('row_id', stored.data?.[0]?.id ?? '')
    expect(audit.data).toEqual([
      { actor_id: seed.supplier.userId, actor_role: 'supplier', action: 'insert' },
    ])

    // Sobrevive a recarregar a página: veio do servidor, não só da tela.
    await page.reload()
    await openMarket(page, market.name)
    await expect(mine.getByRole('button', { name: /ver no calendário/ })).toBeVisible()

    // Cancela pela lista, com a confirmação, e a vaga volta.
    await mine.getByRole('button', { name: 'Cancelar reserva' }).click()
    await mine.getByRole('button', { name: 'Sim, cancelar' }).click()
    await expect(page.getByRole('status')).toContainText('Reserva cancelada')
    await expect(page.getByText('Você ainda não tem reservas.')).toBeVisible()

    const after = await seed.db
      .from('bookings')
      .select('cancelled_at, cancelled_by')
      .eq('market_id', market.id)
    expect(after.data?.[0]?.cancelled_at).not.toBeNull()
    expect(after.data?.[0]?.cancelled_by).toBe(seed.supplier.userId)
  } finally {
    await cleanupBooking(seed.db, market.id, [seed.supplier])
    await seed.cleanup()
  }
})

/** Abre o app como esse fornecedor, num navegador separado (como duas pessoas em dois celulares). */
async function openAs(
  browser: Browser,
  playwrightDevices: Record<string, object>,
  baseURL: string | undefined,
  email: string,
  password: string,
  marketName: string,
): Promise<Page> {
  const context = await browser.newContext({
    ...playwrightDevices['Pixel 7'],
    ...(baseURL === undefined ? {} : { baseURL }),
    timezoneId: 'America/Sao_Paulo',
    locale: 'pt-BR',
  })
  const page = await context.newPage()
  await signIn(page, email, password)
  await openMarket(page, marketName)
  return page
}

test('dois fornecedores disputam a última vaga: um reserva, o outro vê "lotado"', async ({
  browser,
  playwright,
  baseURL,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const market = await createMarket(seed.db, 1, 'Mercado E2E disputa')
  const [first, second] = await createSuppliers(supabase, seed.db, 2)
  if (first === undefined || second === undefined) throw new Error('faltam fornecedores')

  try {
    const [pageA, pageB] = await Promise.all([
      openAs(browser, playwright.devices, baseURL, first.email, first.password, market.name),
      openAs(browser, playwright.devices, baseURL, second.email, second.password, market.name),
    ])

    // Os dois veem o mesmo dia livre e chegam à confirmação.
    for (const page of [pageA, pageB]) {
      await firstFreeDay(page).click()
      await page.getByRole('button', { name: 'Reservar este dia' }).click()
      await expect(page.getByRole('group', { name: 'Confirmar reserva' })).toBeVisible()
    }

    // Confirmam ao mesmo tempo.
    await Promise.all(
      [pageA, pageB].map((page) => page.getByRole('button', { name: 'Confirmar reserva' }).click()),
    )

    const messages = await Promise.all(
      [pageA, pageB].map((page) =>
        page.locator('[role="status"], [role="alert"]').first().innerText(),
      ),
    )
    const confirmed = messages.filter((text) => text.includes('Reserva confirmada'))
    const refused = messages.filter((text) =>
      text.includes('a última vaga deste dia acabou de ser ocupada'),
    )
    expect(confirmed).toHaveLength(1)
    expect(refused).toHaveLength(1)

    // No banco, exatamente uma reserva ativa.
    const stored = await seed.db
      .from('bookings')
      .select('supplier_id')
      .eq('market_id', market.id)
      .is('cancelled_at', null)
    expect(stored.data).toHaveLength(1)

    // Quem perdeu vê o dia lotado e o botão de reservar desligado.
    const loserPage = messages[0]?.includes('a última vaga') ? pageA : pageB
    await expect(loserPage.getByRole('button', { name: /lotado/ })).toBeVisible()
    await expect(loserPage.getByRole('button', { name: 'Reservar este dia' })).toBeDisabled()
  } finally {
    await cleanupBooking(seed.db, market.id, [first, second])
    await seed.cleanup()
  }
})

test('o fornecedor vê quantas vagas restam, nunca quem reservou', async ({ page }) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const market = await createMarket(seed.db, 3, 'Mercado E2E sigilo')
  const [other] = await createSuppliers(supabase, seed.db, 1)
  if (other === undefined) throw new Error('falta fornecedor')

  try {
    // Outro fornecedor reserva amanhã.
    const booked = await other.client.rpc('book_slot_v1', {
      p_market: market.id,
      p_day: companyDay(1),
    })
    expect(booked.error).toBeNull()

    await signIn(page, seed.supplier.email, seed.supplier.password)
    await openMarket(page, market.name)

    // A contagem aparece (2 de 3 livres), o nome do outro não.
    await expect(page.locator('button[data-status="partial"]').first()).toHaveAccessibleName(
      /2 vagas livres de 3/,
    )
    await expect(page.locator('body')).not.toContainText(other.fullName)
    await expect(page.locator('body')).not.toContainText(other.email)

    // E o banco não entrega a reserva alheia nem por consulta direta: o outro fornecedor só vê a dele.
    const own = await other.client.from('bookings').select('supplier_id').eq('market_id', market.id)
    expect(own.data).toEqual([{ supplier_id: other.userId }])
    const names = await other.client.from('profiles').select('id')
    expect(names.data).toEqual([{ id: other.userId }])
  } finally {
    await cleanupBooking(seed.db, market.id, [other])
    await seed.cleanup()
  }
})

test('dia fechado pelo administrador não aceita reserva', async ({ page }) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const market = await createMarket(seed.db, 3, 'Mercado E2E fechado')

  try {
    const closed = await seed.db
      .from('closed_days')
      .insert({ market_id: market.id, day: companyDay(1), reason: 'Inventário' })
    expect(closed.error).toBeNull()

    await signIn(page, seed.supplier.email, seed.supplier.password)
    await openMarket(page, market.name)

    await page.locator('button[data-status="closed"]').first().click()
    await expect(page.getByText('Este dia está fechado para reservas neste mercado.')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reservar este dia' })).toHaveCount(0)
  } finally {
    await cleanupBooking(seed.db, market.id, [])
    await seed.cleanup()
  }
})
