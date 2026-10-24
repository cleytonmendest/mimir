import { expect, test } from '@playwright/test'
import { seedUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'
import { signIn } from './support/ui.ts'

/**
 * Os formulários só reclamam depois que a pessoa sai do campo (nunca enquanto digita), o erro some
 * ao voltar, e o botão de enviar nunca fica desligado: com dados errados ele mostra os erros e leva
 * o foco ao primeiro. No navegador de verdade, com o foco real.
 */

test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' })

test('login: o erro aparece ao sair do campo, some ao voltar, e o envio vazio foca o primeiro erro', async ({
  page,
}) => {
  await page.goto('/')
  const email = page.getByLabel('E-mail')
  const password = page.getByLabel('Senha')

  await email.fill('ana')
  await expect(page.getByRole('alert')).toHaveCount(0)

  await email.fill('')
  await email.press('Tab')
  await expect(page.getByRole('alert')).toHaveText('Informe o e-mail.')
  await expect(email).toHaveAttribute('aria-invalid', 'true')

  await email.click()
  await expect(page.getByText('Informe o e-mail.')).toHaveCount(0)
  await expect(email).not.toHaveAttribute('aria-invalid', 'true')

  const enter = page.getByRole('button', { name: 'Entrar' })
  await expect(enter).toBeEnabled()
  await enter.click()
  await expect(page.getByRole('alert')).toHaveText(['Informe o e-mail.', 'Informe a senha.'])
  await expect(email).toBeFocused()

  // Corrigir tira o erro do campo; a senha continua apontada até a pessoa mexer nela.
  await email.fill('ana@loja.com')
  await expect(page.getByRole('alert')).toHaveText(['Informe a senha.'])
  await password.fill('qualquer-senha')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('novo mercado: nome vazio é apontado ao sair do campo e no envio; com nome, cadastra', async ({
  page,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const name = `Mercado E2E validação ${Date.now()}`

  try {
    await signIn(page, seed.admin.email, seed.admin.password)
    await page.getByRole('button', { name: 'Mercados', exact: true }).click()
    const form = page.getByRole('form', { name: 'Novo mercado' })
    const nameField = form.getByLabel('Nome', { exact: true })

    await nameField.click()
    await nameField.press('Tab')
    await expect(form.getByRole('alert')).toHaveText('Informe o nome do mercado.')

    await form.getByRole('button', { name: 'Cadastrar mercado' }).click()
    await expect(nameField).toBeFocused()
    await expect(form.getByRole('alert')).toHaveText('Informe o nome do mercado.')

    await nameField.fill(name)
    await expect(form.getByRole('alert')).toHaveCount(0)
    await form.getByRole('button', { name: 'Cadastrar mercado' }).click()
    await expect(page.getByRole('heading', { name, level: 3 })).toBeVisible()
  } finally {
    await seed.db.from('markets').delete().eq('name', name)
    await seed.cleanup()
  }
})
