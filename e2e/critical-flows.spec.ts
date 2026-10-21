import { expect, test, type Page } from '@playwright/test'
import { seedRepositor } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'

/**
 * Os dois fluxos que não podem quebrar. O do líder segue como test.fixme até existir a tela:
 * aparece como "pendente" em todo relatório, e quem implementar a tela troca por test().
 *
 * Os testes com banco usam o Supabase local de verdade (RLS, triggers e auditoria incluídos).
 * O fuso é fixo em São Paulo para o "hoje" do teste ser o mesmo "hoje" do navegador.
 */

const TIME_ZONE = 'America/Sao_Paulo'

/** "AAAA-MM-DD" de hoje no fuso do teste. */
function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByRole('heading', { name: 'Hoje' })).toBeVisible()
}

test.use({ timezoneId: TIME_ZONE, locale: 'pt-BR' })

test('o app abre', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Rota do repositor' })).toBeVisible()
})

test('repositor abre a tela Hoje, faz check-in, check-out e a visita fica "Feita"', async ({
  page,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const day = today()
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay()
  const seed = await seedRepositor(supabase, weekday)

  try {
    // 1. entrar como repositor  2. ver as visitas de hoje em ordem
    await signIn(page, seed.email, seed.password)
    await expect(page.getByText(`${seed.fullName} · Repositor`)).toBeVisible()
    await expect(page.getByText(/^Versão \d+\.\d+\.\d+\+\w+$/)).toBeVisible()
    const cards = page.getByRole('list', { name: 'Visitas de hoje' }).getByRole('listitem')
    await expect(cards).toHaveCount(2)
    await expect(cards.nth(0).getByRole('heading')).toHaveText(seed.marketNames[0])
    await expect(cards.nth(1).getByRole('heading')).toHaveText(seed.marketNames[1])
    await expect(cards.nth(0).getByText('Planejada')).toBeVisible()

    // 3. check-in numa visita
    const first = cards.nth(0)
    await first.getByRole('button', { name: /Fazer check-in/ }).click()
    await expect(first.getByText('Em andamento')).toBeVisible()

    // 4. check-out com observação
    await first.getByRole('button', { name: /Fazer check-out/ }).click()
    await first.getByLabel('Observação (opcional)').fill('Gôndola reposta')
    await first.getByRole('button', { name: 'Concluir visita' }).click()

    // 5. status "Feita" e horários gravados (e a outra visita intacta)
    await expect(first.getByText('Feita')).toBeVisible()
    await expect(first.getByText('Observação: Gôndola reposta')).toBeVisible()
    await expect(first.getByText(/^Entrada \d{2}:\d{2} · Saída \d{2}:\d{2}$/)).toBeVisible()
    await expect(cards.nth(1).getByText('Planejada')).toBeVisible()

    // Sobrevive a recarregar a página: veio do servidor, não só da tela.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Hoje' })).toBeVisible()
    await expect(cards.nth(0).getByText('Feita')).toBeVisible()
    await expect(cards.nth(1).getByText('Planejada')).toBeVisible()

    // E no banco: horários, observação e quem fez, na auditoria.
    const stored = await seed.admin
      .from('visits')
      .select('id, status, note, check_in_at, check_out_at, origin')
      .eq('repositor_id', seed.userId)
      .eq('visit_date', day)
      .order('position')
    expect(stored.error).toBeNull()
    const [done, planned] = stored.data ?? []
    expect(done).toMatchObject({ status: 'done', note: 'Gôndola reposta', origin: 'standard' })
    expect(done?.check_in_at).not.toBeNull()
    expect(Date.parse(done?.check_out_at ?? '')).toBeGreaterThanOrEqual(
      Date.parse(done?.check_in_at ?? ''),
    )
    expect(planned).toMatchObject({ status: 'planned', check_in_at: null })

    const audit = await seed.admin
      .from('audit_log')
      .select('actor_id, actor_role, action')
      .eq('table_name', 'visits')
      .eq('row_id', done?.id ?? '')
      .eq('action', 'update')
    expect(audit.data).toHaveLength(2)
    expect(audit.data?.every((row) => row.actor_id === seed.userId)).toBe(true)
    expect(audit.data?.every((row) => row.actor_role === 'repositor')).toBe(true)
  } finally {
    await seed.cleanup()
  }
})

test('repositor marca que não foi a uma visita, com o motivo', async ({ page }) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const day = today()
  const seed = await seedRepositor(supabase, new Date(`${day}T12:00:00Z`).getUTCDay())

  try {
    await signIn(page, seed.email, seed.password)
    const second = page.getByRole('list', { name: 'Visitas de hoje' }).getByRole('listitem').nth(1)

    await second.getByRole('button', { name: /Não fui/ }).click()
    await second.getByRole('button', { name: 'Confirmar' }).click()
    await expect(second.getByRole('alert')).toHaveText('Informe o motivo de não ter ido.')

    await second.getByLabel('Por que não foi?').fill('Loja fechada')
    await second.getByRole('button', { name: 'Confirmar' }).click()

    await expect(second.getByText('Não foi')).toBeVisible()
    await expect(second.getByText('Motivo: Loja fechada')).toBeVisible()
    const stored = await seed.admin
      .from('visits')
      .select('status, skip_reason')
      .eq('repositor_id', seed.userId)
      .eq('visit_date', day)
      .eq('status', 'not_done')
    expect(stored.data).toEqual([{ status: 'not_done', skip_reason: 'Loja fechada' }])
  } finally {
    await seed.cleanup()
  }
})

test.fixme('líder remaneja um mercado de um dia para outro e a mudança fica no log', async () => {
  // 1. entrar como líder  2. abrir a semana de um repositor  3. mover um mercado para outro dia
  // 4. o repositor vê a mudança  5. o log mostra quem mudou o quê
})
