import { expect, test } from '@playwright/test'
import { seedUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'
import { signIn } from './support/ui.ts'

/**
 * Detalhes que só o navegador de verdade confirma: o rascunho do formulário sobrevive a recarregar
 * a página (e não passa para a próxima pessoa), e o botão só de ícone mostra o tooltip no foco do
 * teclado e some com Esc.
 */

test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' })

test('o rascunho do novo mercado volta ao recarregar a página, e sair da conta o apaga', async ({
  page,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)

  try {
    await signIn(page, seed.admin.email, seed.admin.password)
    await page.getByRole('button', { name: 'Mercados', exact: true }).click()
    const form = page.getByRole('form', { name: 'Novo mercado' })
    await form.getByLabel('Nome', { exact: true }).fill('Mercado Rascunho')
    await form.getByLabel('Endereço (opcional)').fill('Rua do Rascunho 10 - Leblon')

    await page.reload()
    await page.getByRole('button', { name: 'Mercados', exact: true }).click()
    const again = page.getByRole('form', { name: 'Novo mercado' })
    await expect(again.getByLabel('Nome', { exact: true })).toHaveValue('Mercado Rascunho')
    await expect(again.getByLabel('Endereço (opcional)')).toHaveValue('Rua do Rascunho 10 - Leblon')
    await expect(again.getByText('Recuperamos o que você tinha digitado.')).toBeVisible()

    await again.getByRole('button', { name: 'Descartar rascunho' }).click()
    await expect(again.getByLabel('Nome', { exact: true })).toHaveValue('')

    // Sair da conta apaga o que sobrou: a próxima pessoa não herda o rascunho.
    await again.getByLabel('Nome', { exact: true }).fill('Outro rascunho')
    await page.getByRole('button', { name: 'Sair' }).click()
    await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
    const kept = await page.evaluate(() => {
      const storage = (globalThis as unknown as { sessionStorage: { length: number } })
        .sessionStorage
      return storage.length
    })
    expect(kept).toBe(0)
  } finally {
    await seed.cleanup()
  }
})

test('o botão só de ícone mostra o tooltip no foco do teclado e some com Esc', async ({ page }) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)

  try {
    await signIn(page, seed.supplier.email, seed.supplier.password)
    const next = page.getByRole('button', { name: 'Próximo mês' })
    await expect(next).toBeVisible()
    // O mês de hoje não tem "anterior" (nada para trás): o botão existe, mas está desligado.
    await expect(page.getByRole('button', { name: 'Mês anterior' })).toBeDisabled()

    await next.focus()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(next).toBeFocused()
    await expect(page.getByRole('tooltip')).toHaveText('Próximo mês')

    await page.keyboard.press('Escape')
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  } finally {
    await seed.cleanup()
  }
})
