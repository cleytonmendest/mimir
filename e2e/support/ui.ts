import { expect, type Browser, type Page } from '@playwright/test'

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

/** Entra como administrador e abre a agenda de um mercado pelo nome. */
export async function openAgenda(page: Page, marketName: string) {
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible()
  await page.getByRole('button', { name: new RegExp(`^${marketName}`) }).click()
  await expect(page.getByRole('heading', { name: /^\w+ de \d{4}$/ })).toBeVisible()
}

/** Um celular novo, sem sessão nenhuma: outra pessoa abrindo o app (ou um link que recebeu). */
export async function newPhone(
  browser: Browser,
  devices: Record<string, object>,
  baseURL: string | undefined,
): Promise<Page> {
  const context = await browser.newContext({
    ...devices['Pixel 7'],
    ...(baseURL === undefined ? {} : { baseURL }),
    timezoneId: 'America/Sao_Paulo',
    locale: 'pt-BR',
  })
  return context.newPage()
}
