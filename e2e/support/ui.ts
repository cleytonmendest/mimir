import { expect, type Page } from '@playwright/test'

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/')
  await page.getByLabel('E-mail').fill(email)
  await page.getByLabel('Senha').fill(password)
  await page.getByRole('button', { name: 'Entrar' }).click()
}

/** Entra como fornecedor e escolhe o mercado pelo nome. O calendário abre no mês de amanhã. */
export async function openMarket(page: Page, marketName: string) {
  await expect(page.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`^${marketName}`) }).click()
  await expect(page.getByRole('heading', { name: /^\w+ de \d{4}$/ })).toBeVisible()
}

/** O primeiro dia reservável do calendário: amanhã, que sempre cai no mês que abre. */
export function firstFreeDay(page: Page) {
  return page.locator('button[data-status="free"]').first()
}
