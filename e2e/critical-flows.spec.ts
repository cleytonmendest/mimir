import { expect, test, type Page } from '@playwright/test'
import { seedUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'

/**
 * Os fluxos que não podem quebrar. Os de reserva seguem como test.fixme até existir a tela: aparecem
 * como "pendentes" em todo relatório, e quem implementar a tela troca por test().
 *
 * Os testes com banco usam o Supabase local de verdade (RLS, triggers e auditoria incluídos).
 */

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' })

test('o app abre', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Agenda de Degustações' })).toBeVisible()
})

test('o fornecedor entra, cai na área de reservas e consegue sair', async ({ page }) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)

  try {
    await signIn(page, seed.supplier.email, seed.supplier.password)

    await expect(page.getByRole('heading', { name: 'Reservas' })).toBeVisible()
    await expect(page.getByText(`${seed.supplier.fullName} · Fornecedor`)).toBeVisible()
    await expect(page.getByText(/^Versão \d+\.\d+\.\d+\+\w+$/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Mercados' })).toBeHidden()

    // A sessão sobrevive a recarregar a página.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Reservas' })).toBeVisible()

    await page.getByRole('button', { name: 'Sair' }).click()
    await expect(page.getByLabel('E-mail')).toBeVisible()
  } finally {
    await seed.cleanup()
  }
})

test('o administrador entra e cai na área de mercados, não na de reservas', async ({ page }) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)

  try {
    await signIn(page, seed.admin.email, seed.admin.password)

    await expect(page.getByRole('heading', { name: 'Mercados' })).toBeVisible()
    await expect(page.getByText(`${seed.admin.fullName} · Administrador`)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Reservas' })).toBeHidden()
  } finally {
    await seed.cleanup()
  }
})

test('quem se cadastra nunca nasce administrador: o papel vem do banco, não do cadastro', async () => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)

  try {
    const profiles = await seed.db
      .from('profiles')
      .select('id, role')
      .in('id', [seed.admin.userId, seed.supplier.userId])
    expect(profiles.error).toBeNull()
    const role = (id: string) => profiles.data?.find((row) => row.id === id)?.role
    expect(role(seed.supplier.userId)).toBe('supplier')
    expect(role(seed.admin.userId)).toBe('admin')
  } finally {
    await seed.cleanup()
  }
})

test.fixme('o fornecedor reserva um dia com vaga e cancela a reserva', async () => {
  // 1. entrar como fornecedor  2. escolher o mercado  3. escolher um dia com vaga e reservar
  // 4. o dia aparece em "Minhas reservas" e a vaga diminui  5. cancelar e a vaga volta
})

test.fixme('dois fornecedores disputam a última vaga: um reserva, o outro vê "lotado"', async () => {
  // 1. dois navegadores, dois fornecedores, o mesmo mercado e dia com uma vaga
  // 2. os dois confirmam ao mesmo tempo  3. exatamente uma reserva existe no banco
  // 4. quem perdeu vê "acabou de lotar" e a tela atualiza
})
