import { expect, test } from '@playwright/test'
import { seedUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'
import { signIn } from './support/ui.ts'

/**
 * Entrar e cair na área certa do papel. Os fluxos de reserva estão em booking-flows.spec.ts.
 *
 * Os testes com banco usam o Supabase local de verdade (RLS, triggers e auditoria incluídos).
 */

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

    await expect(page.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()
    await expect(page.getByText(`${seed.supplier.fullName} · Fornecedor`)).toBeVisible()
    await expect(page.getByText(/^Versão \d+\.\d+\.\d+\+\w+$/)).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Minhas reservas' })).toBeVisible()

    // A sessão sobrevive a recarregar a página.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()

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
    await expect(page.getByRole('heading', { name: 'Reservas', exact: true })).toBeHidden()
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
