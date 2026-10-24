import axe from 'axe-core'
import { expect, test, type Page } from '@playwright/test'
import { resetSignupState } from './support/functions.ts'
import { cleanupBooking, createMarket, createSuppliers, seedUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'
import { firstFreeDay, newPhone, openAgenda, openMarket, signIn } from './support/ui.ts'

/**
 * Acessibilidade de cada tela de verdade (WCAG 2.1 A e AA, que inclui contraste), nos dois temas.
 * O Storybook já roda o axe em cada componente; aqui as telas inteiras, com dados reais.
 */

test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' })

const THEMES = ['light', 'dark'] as const

async function violations(page: Page, label: string): Promise<string[]> {
  await page.addScriptTag({ content: axe.source })
  const result = await page.evaluate(async () => {
    const found = await (globalThis as unknown as { axe: typeof axe }).axe.run({
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    })
    return found.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact ?? '',
      help: violation.help,
      targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
    }))
  })
  return result.map(
    (violation) =>
      `${label}: [${violation.impact}] ${violation.id} — ${violation.help} (${violation.targets.join(' | ')})`,
  )
}

async function audit(page: Page, label: string, found: string[]) {
  // Sem transições: logo depois de trocar o tema as cores ainda estão no meio do caminho, e o axe
  // mediria o contraste de uma cor que ninguém chega a ver.
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  })
  for (const scheme of THEMES) {
    await page.emulateMedia({ colorScheme: scheme })
    found.push(...(await violations(page, `${label} (${scheme})`)))
  }
}

test('telas do fornecedor, do administrador e as páginas públicas, nos dois temas', async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  await resetSignupState(seed.db)
  const market = await createMarket(seed.db, 3, 'Mercado E2E acessibilidade')
  // Com um só mercado a busca não aparece; com dois, ela entra nas telas auditadas.
  const second = await createMarket(seed.db, 3, 'Mercado E2E acessibilidade', 'Rua Teste 1 - Gávea')
  const [supplier, other] = await createSuppliers(supabase, seed.db, 2)
  if (supplier === undefined || other === undefined) throw new Error('faltam fornecedores')
  const found: string[] = []

  try {
    // Entrada e páginas públicas.
    await page.goto('/')
    await page.getByLabel('E-mail').waitFor()
    await audit(page, 'entrada', found)
    // A mesma tela com os erros à mostra (texto de erro, campos marcados).
    await page.getByRole('button', { name: 'Entrar' }).click()
    await page.getByRole('alert').first().waitFor()
    await audit(page, 'entrada com erros', found)

    await page.goto('/definir-senha?token=qualquer')
    await page.getByRole('button', { name: 'Definir minha senha' }).waitFor()
    await audit(page, 'definir senha', found)

    await page.goto('/cadastro')
    await page.getByText(/O cadastro está fechado/).waitFor()
    await audit(page, 'cadastro fechado', found)

    // O fornecedor, com um dia escolhido e a confirmação aberta.
    const phone = await newPhone(browser, playwright.devices, baseURL)
    await signIn(phone, supplier.email, supplier.password)
    await audit(phone, 'fornecedor: lista de mercados', found)
    const phoneSearch = phone.getByRole('searchbox', { name: 'Buscar por bairro ou nome' })
    await phoneSearch.fill('gavea')
    await phone.getByText(/^\d+ de \d+ mercados$/).waitFor()
    await audit(phone, 'fornecedor: busca com resultado', found)
    await phoneSearch.fill('sem nenhuma loja assim')
    await phone.getByText('Nenhum mercado encontrado.').waitFor()
    await audit(phone, 'fornecedor: busca sem resultado', found)
    await phone.getByRole('button', { name: 'Limpar busca' }).click()
    await openMarket(phone, market.name)
    await audit(phone, 'fornecedor: calendário', found)
    await firstFreeDay(phone).click()
    await phone.getByRole('button', { name: 'Reservar este dia' }).click()
    await phone.getByRole('group', { name: 'Confirmar reserva' }).waitFor()
    await audit(phone, 'fornecedor: confirmar reserva', found)
    await phone.getByRole('button', { name: 'Confirmar reserva' }).click()
    await phone.getByText(/Reserva confirmada/).waitFor()
    await phone.getByRole('heading', { name: 'Minhas reservas' }).waitFor()
    await audit(phone, 'fornecedor: reserva feita', found)

    // O administrador: as quatro áreas.
    await signIn(page, seed.admin.email, seed.admin.password)
    await page.getByRole('searchbox', { name: 'Buscar por bairro ou nome' }).fill('gavea')
    await page.getByText(/^\d+ de \d+ mercados$/).waitFor()
    await audit(page, 'administrador: agenda com busca', found)
    await page.getByRole('button', { name: 'Limpar busca' }).click()
    await openAgenda(page, market.name)
    await page.locator('button[data-status="partial"]').first().click()
    await audit(page, 'administrador: agenda', found)

    await page.getByRole('button', { name: 'Mercados', exact: true }).click()
    await page.getByRole('heading', { name: 'Seus mercados' }).waitFor()
    await audit(page, 'administrador: mercados', found)

    await page.getByRole('button', { name: 'Fornecedores', exact: true }).click()
    await page.getByRole('button', { name: `Desativar ${supplier.fullName}` }).click()
    await audit(page, 'administrador: fornecedores', found)
    await page.getByLabel('Nome ou empresa').fill('Doces da Vó')
    await page.getByLabel('E-mail').fill(`a11y-${Date.now()}@test.dev`)
    await page.getByRole('button', { name: 'Cadastrar fornecedor' }).click()
    await page.getByRole('region', { name: 'Link de acesso' }).waitFor()
    await page.getByRole('button', { name: 'Fechar o link' }).click()
    await audit(page, 'administrador: link de acesso', found)

    await page.getByRole('button', { name: 'Configurações', exact: true }).click()
    await page.getByRole('button', { name: 'Com código' }).click()
    await page.getByLabel('Código de convite').waitFor()
    await audit(page, 'administrador: configurações', found)

    // A página de cadastro, agora com código.
    const visitor = await newPhone(browser, playwright.devices, baseURL)
    await visitor.goto('/cadastro?codigo=K7QD-4MXA')
    await visitor.getByLabel('Código de convite').waitFor()
    await audit(visitor, 'cadastro com código', found)

    expect(found, found.join('\n')).toEqual([])
  } finally {
    const created = await seed.db.from('profiles').select('id').like('email', 'a11y-%')
    for (const profile of created.data ?? []) await seed.db.auth.admin.deleteUser(profile.id)
    await resetSignupState(seed.db)
    await cleanupBooking(seed.db, market.id, [supplier, other])
    await seed.db.from('markets').delete().eq('id', second.id)
    await seed.cleanup()
  }
})
