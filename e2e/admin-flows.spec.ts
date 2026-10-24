import { expect, test } from '@playwright/test'
import { companyDay } from './support/dates.ts'
import { cleanupBooking, createMarket, createSuppliers, seedUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'
import { openAgenda, openMarket, signIn } from './support/ui.ts'

/**
 * O que o administrador faz sem precisar tocar no banco: cadastrar mercado, mudar o limite, ver quem
 * reservou, cancelar uma reserva e fechar uma data. Contra o Supabase local, com RLS e auditoria.
 */

test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' })

test('o administrador cadastra um mercado e muda o limite; o fornecedor vê o limite novo', async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const name = `Mercado Admin E2E ${Date.now()}`

  try {
    await signIn(page, seed.admin.email, seed.admin.password)
    await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible()
    await page.getByRole('button', { name: 'Mercados', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Seus mercados' })).toBeVisible()

    // Cadastra.
    await page.getByLabel('Nome', { exact: true }).fill(name)
    await page.getByLabel('Endereço (opcional)').fill('Rua das Flores, 10')
    await page.getByRole('button', { name: 'Cadastrar mercado' }).click()
    await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible()

    const created = await seed.db.from('markets').select('id, capacity, address').eq('name', name)
    expect(created.data).toHaveLength(1)
    expect(created.data?.[0]).toMatchObject({ capacity: 3, address: 'Rua das Flores, 10' })
    const marketId = created.data?.[0]?.id ?? ''

    // Muda o limite para 4.
    const stepper = page.getByRole('group', { name: `Limite de estandes por dia, ${name}` })
    await stepper.getByRole('button', { name: /^Aumentar/ }).click()
    await expect(page.getByText(`Limite de ${name}: 4 estandes por dia.`)).toBeVisible()
    await expect
      .poll(
        async () =>
          (await seed.db.from('markets').select('capacity').eq('id', marketId)).data?.[0]?.capacity,
      )
      .toBe(4)

    // A auditoria diz quem mudou.
    const audit = await seed.db
      .from('audit_log')
      .select('actor_id, actor_role, action')
      .eq('table_name', 'markets')
      .eq('row_id', marketId)
      .order('id')
    expect(audit.data).toEqual([
      { actor_id: seed.admin.userId, actor_role: 'admin', action: 'insert' },
      { actor_id: seed.admin.userId, actor_role: 'admin', action: 'update' },
    ])

    // O fornecedor, em outro navegador, vê o limite novo.
    const context = await browser.newContext({
      ...playwright.devices['Pixel 7'],
      ...(baseURL === undefined ? {} : { baseURL }),
      timezoneId: 'America/Sao_Paulo',
      locale: 'pt-BR',
    })
    const supplierPage = await context.newPage()
    await signIn(supplierPage, seed.supplier.email, seed.supplier.password)
    await openMarket(supplierPage, name)
    // No cartão deste mercado (o pai do botão com o nome): o banco local de desenvolvimento (seed) tem
    // outros mercados com 4 estandes, então o texto solto na página casaria com mais de um.
    const card = supplierPage.getByRole('button', { name: new RegExp(`^${name}`) }).locator('..')
    await expect(card).toContainText('4 estandes/dia')
    await context.close()

    // Arquiva: some para o fornecedor.
    await page.getByRole('button', { name: `Arquivar ${name}` }).click()
    await page.getByRole('button', { name: 'Sim, arquivar' }).click()
    await expect(page.getByText('Arquivado: não aceita novas reservas')).toBeVisible()
    await seed.db.from('markets').delete().eq('id', marketId)
  } finally {
    await seed.db.from('markets').delete().eq('name', name)
    await seed.cleanup()
  }
})

test('o administrador vê quem reservou, cancela uma reserva com motivo e fecha uma data', async ({
  page,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const market = await createMarket(seed.db, 3, 'Mercado Admin agenda')
  const [other] = await createSuppliers(supabase, seed.db, 1)
  if (other === undefined) throw new Error('falta fornecedor')

  try {
    const booked = await other.client.rpc('book_slot_v1', {
      p_market: market.id,
      p_day: companyDay(1),
    })
    expect(booked.error).toBeNull()

    await signIn(page, seed.admin.email, seed.admin.password)
    await openAgenda(page, market.name)

    // Escolhe o dia da reserva: o administrador vê o nome do fornecedor.
    await page.locator('button[data-status="partial"]').first().click()
    const panel = page.locator('section[aria-labelledby="agenda-day-title"]')
    await expect(panel.getByText(other.fullName)).toBeVisible()
    // E não há botão de reservar: o administrador não reserva estande.
    await expect(page.getByRole('button', { name: 'Reservar este dia' })).toHaveCount(0)

    // Cancela com motivo.
    await panel.getByRole('button', { name: `Cancelar a reserva de ${other.fullName}` }).click()
    await panel.getByLabel('Motivo (opcional)').fill('Fornecedor avisou que não vem')
    await panel.getByRole('button', { name: 'Cancelar reserva' }).click()
    await expect(
      page.getByText('Reserva cancelada. O sistema não avisa o fornecedor'),
    ).toBeVisible()
    await expect(panel.getByText('Nenhuma reserva neste dia.')).toBeVisible()

    const cancelled = await seed.db
      .from('bookings')
      .select('cancelled_by, cancel_reason')
      .eq('market_id', market.id)
    expect(cancelled.data).toEqual([
      { cancelled_by: seed.admin.userId, cancel_reason: 'Fornecedor avisou que não vem' },
    ])

    // Fecha a data, com motivo.
    await panel.getByLabel('Motivo, se for fechar (opcional)').fill('Inventário')
    await panel.getByRole('button', { name: 'Fechar este dia para novas reservas' }).click()
    await expect(page.getByText('Dia fechado para novas reservas.')).toBeVisible()
    await expect(panel.getByText('Motivo: Inventário')).toBeVisible()

    const closed = await seed.db
      .from('closed_days')
      .select('day, reason')
      .eq('market_id', market.id)
    expect(closed.data).toEqual([{ day: companyDay(1), reason: 'Inventário' }])

    // O fornecedor agora não consegue reservar o dia fechado.
    const refused = await other.client.rpc('book_slot_v1', {
      p_market: market.id,
      p_day: companyDay(1),
    })
    expect((refused.data as { code?: string } | null)?.code).toBe('CLOSED')

    // Libera de novo.
    await panel.getByRole('button', { name: 'Liberar este dia' }).click()
    await expect(page.getByText('Dia liberado para reservas.')).toBeVisible()
  } finally {
    await cleanupBooking(seed.db, market.id, [other])
    await seed.cleanup()
  }
})
