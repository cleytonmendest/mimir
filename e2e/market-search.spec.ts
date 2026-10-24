import { expect, test, type Page } from '@playwright/test'
import { createMarket, seedUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'
import { openMarket, signIn } from './support/ui.ts'

/**
 * A busca de mercados por bairro ou nome, para quem tem dezenas de lojas na lista: fornecedor e
 * administrador. Os nomes e bairros usam palavras que as lojas do seed não têm, então o teste vale
 * com o banco vazio (CI) e com o seed de desenvolvimento (31 lojas).
 */

test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' })

const SEARCH = 'Buscar por bairro ou nome'

async function createMarkets(seed: Awaited<ReturnType<typeof seedUsers>>) {
  const norte = await createMarket(seed.db, 3, 'Quartzo Norte', 'Rua das Acácias 10 - Jardim Ônix')
  const sul = await createMarket(seed.db, 3, 'Quartzo Sul', 'Rua do Cedro 5 - Vila Opala')
  const outra = await createMarket(seed.db, 3, 'Turmalina', 'Av. Central 1 - Jardim Ônix')
  return { norte, sul, outra, all: [norte.id, sul.id, outra.id] }
}

function marketButton(page: Page, name: string) {
  return page.getByRole('button', { name: new RegExp(`^${name}`) })
}

test('o fornecedor acha a loja pelo bairro, sem acento e sem ligar para caixa', async ({
  page,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const markets = await createMarkets(seed)

  try {
    await signIn(page, seed.supplier.email, seed.supplier.password)
    await expect(page.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()
    const field = page.getByRole('searchbox', { name: SEARCH })

    // O bairro está no endereço: "JARDIM onix" acha as duas lojas do Jardim Ônix, e só elas.
    await field.fill('JARDIM onix')
    await expect(marketButton(page, markets.norte.name)).toBeVisible()
    await expect(marketButton(page, markets.outra.name)).toBeVisible()
    await expect(marketButton(page, markets.sul.name)).toHaveCount(0)
    await expect(page.getByText(/^2 de \d+ mercados$/)).toBeVisible()

    // Todas as palavras têm de aparecer: junta o nome e fica uma só.
    await field.fill('jardim onix quartzo')
    await expect(marketButton(page, markets.norte.name)).toBeVisible()
    await expect(marketButton(page, markets.outra.name)).toHaveCount(0)
    await expect(page.getByText(/^1 de \d+ mercados$/)).toBeVisible()

    // Sem resultado, diz isso em vez de deixar a tela vazia.
    await field.fill('zzzz sem loja')
    await expect(page.getByText('Nenhum mercado encontrado.')).toBeVisible()

    // O "x" limpa, devolve o foco ao campo e traz todas as lojas de volta.
    await page.getByRole('button', { name: 'Limpar busca' }).click()
    await expect(field).toHaveValue('')
    await expect(field).toBeFocused()
    for (const market of [markets.norte, markets.sul, markets.outra]) {
      await expect(marketButton(page, market.name)).toBeVisible()
    }

    // Do resultado da busca ao calendário: é o mesmo caminho de sempre.
    await field.fill('vila opala')
    await openMarket(page, markets.sul.name)

    // No celular a lista se recolhe: sobra o mercado escolhido e o botão "Trocar de mercado".
    const change = page.getByRole('button', { name: 'Trocar de mercado' })
    await expect(change).toBeVisible()
    await expect(marketButton(page, markets.sul.name)).toBeVisible()
    await expect(marketButton(page, markets.norte.name)).toHaveCount(0)
    // Trocar traz a lista inteira de volta, com a busca limpa e o foco nela.
    await change.click()
    await expect(field).toBeFocused()
    await expect(field).toHaveValue('')
    await expect(marketButton(page, markets.norte.name)).toBeVisible()
  } finally {
    await seed.db.from('markets').delete().in('id', markets.all)
    await seed.cleanup()
  }
})

test('o administrador filtra a lista de mercados e a agenda pela mesma busca', async ({ page }) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const markets = await createMarkets(seed)

  try {
    await signIn(page, seed.admin.email, seed.admin.password)
    await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible()

    // Agenda: escolhe o mercado pelo bairro.
    await page.getByRole('searchbox', { name: SEARCH }).fill('vila opala')
    await expect(marketButton(page, markets.sul.name)).toBeVisible()
    await expect(marketButton(page, markets.norte.name)).toHaveCount(0)

    // Mercados: a mesma busca, agora para editar o limite.
    await page.getByRole('button', { name: 'Mercados', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Seus mercados' })).toBeVisible()
    await page.getByRole('searchbox', { name: SEARCH }).fill('turmalina')
    await expect(page.getByRole('heading', { name: markets.outra.name, level: 3 })).toBeVisible()
    await expect(page.getByRole('heading', { name: markets.norte.name, level: 3 })).toHaveCount(0)
    await expect(
      page.getByRole('group', { name: `Limite de estandes por dia, ${markets.outra.name}` }),
    ).toBeVisible()
  } finally {
    await seed.db.from('markets').delete().in('id', markets.all)
    await seed.cleanup()
  }
})
