import { expect, test, type Page } from '@playwright/test'
import { deleteUsersByEmail, resetSignupState, uniqueEmail } from './support/functions.ts'
import { cleanupBooking, createMarket, createSuppliers, seedUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'
import { firstFreeDay, newPhone, openMarket, signIn } from './support/ui.ts'

/**
 * Como o fornecedor ganha acesso, no navegador, contra o Supabase local: o administrador cadastra
 * e envia um link; a página de cadastro nos três modos; desativar corta o acesso na hora.
 */

test.use({ timezoneId: 'America/Sao_Paulo', locale: 'pt-BR' })

const PASSWORD = 'uma-senha-bem-longa'

async function openAdminTab(page: Page, name: string) {
  await expect(page.getByRole('heading', { name: 'Administração' })).toBeVisible()
  await page.getByRole('button', { name, exact: true }).click()
}

test('o administrador cadastra um fornecedor, que define a senha pelo link e reserva', async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const market = await createMarket(seed.db, 3, 'Mercado E2E acesso')
  const email = uniqueEmail('novo-fornecedor')
  const name = `Doces da Vó ${Date.now()}`

  try {
    await signIn(page, seed.admin.email, seed.admin.password)
    await openAdminTab(page, 'Fornecedores')
    await page.getByLabel('Nome ou empresa').fill(name)
    await page.getByLabel('E-mail').fill(email)
    await page.getByRole('button', { name: 'Cadastrar fornecedor' }).click()

    const panel = page.getByRole('region', { name: 'Link de acesso' })
    await expect(panel).toBeVisible()
    await expect(panel.getByRole('link', { name: 'Enviar pelo WhatsApp' })).toHaveAttribute(
      'href',
      /^https:\/\/wa\.me\/\?text=/,
    )
    const link = await panel.getByLabel('Link').inputValue()
    expect(link).toMatch(/\/definir-senha\?token=/)

    // O fornecedor abre o link no celular dele.
    const phone = await newPhone(browser, playwright.devices, baseURL)
    await phone.goto(link)
    await expect(phone.getByRole('heading', { name: 'Defina a sua senha' })).toBeVisible()
    await phone.getByRole('button', { name: 'Continuar' }).click()
    await phone.getByLabel('Escolha a sua senha').fill(PASSWORD)
    await phone.getByRole('button', { name: 'Salvar senha e entrar' }).click()

    // Já cai na área de reservas, logado.
    await expect(phone.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()
    await expect(phone.getByText(`${name} · Fornecedor`)).toBeVisible()

    // E consegue reservar um dia.
    await openMarket(phone, market.name)
    await firstFreeDay(phone).click()
    await phone.getByRole('button', { name: 'Reservar este dia' }).click()
    await phone.getByRole('button', { name: 'Confirmar reserva' }).click()
    await expect(phone.getByText(/Reserva confirmada/)).toBeVisible()

    // O link só vale uma vez.
    const another = await newPhone(browser, playwright.devices, baseURL)
    await another.goto(link)
    await another.getByRole('button', { name: 'Continuar' }).click()
    await expect(another.getByRole('alert')).toContainText('venceu ou já foi usado')

    // A senha escolhida entra de verdade, em outro aparelho.
    const third = await newPhone(browser, playwright.devices, baseURL)
    await signIn(third, email, PASSWORD)
    await expect(third.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()
  } finally {
    const profile = await seed.db.from('profiles').select('id').eq('email', email).maybeSingle()
    if (profile.data !== null) {
      await cleanupBooking(seed.db, market.id, [{ userId: profile.data.id }])
    } else {
      await seed.db.from('markets').delete().eq('id', market.id)
    }
    await seed.cleanup()
  }
})

test('desativar um fornecedor corta o acesso na hora e libera as vagas; reativar devolve', async ({
  page,
  browser,
  playwright,
  baseURL,
}) => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedUsers(supabase)
  const market = await createMarket(seed.db, 1, 'Mercado E2E desativar')
  const [supplier, other] = await createSuppliers(supabase, seed.db, 2)
  if (supplier === undefined || other === undefined) throw new Error('faltam fornecedores')

  try {
    // O fornecedor já está logado e com a única vaga do dia reservada.
    const phone = await newPhone(browser, playwright.devices, baseURL)
    await signIn(phone, supplier.email, supplier.password)
    await openMarket(phone, market.name)
    await firstFreeDay(phone).click()
    await phone.getByRole('button', { name: 'Reservar este dia' }).click()
    await phone.getByRole('button', { name: 'Confirmar reserva' }).click()
    await expect(phone.getByText(/Reserva confirmada/)).toBeVisible()

    // O administrador o desativa.
    await signIn(page, seed.admin.email, seed.admin.password)
    await openAdminTab(page, 'Fornecedores')
    await page.getByRole('button', { name: `Desativar ${supplier.fullName}` }).click()
    await page.getByRole('button', { name: 'Sim, desativar' }).click()
    await expect(
      page.getByText(`${supplier.fullName} foi desativado. 1 reserva futura cancelada.`),
    ).toBeVisible()

    // No banco: conta desativada e a reserva cancelada.
    const stored = await seed.db
      .from('bookings')
      .select('cancelled_at, cancel_reason')
      .eq('supplier_id', supplier.userId)
    expect(stored.data?.[0]?.cancelled_at).not.toBeNull()
    expect(stored.data?.[0]?.cancel_reason).toBe('Fornecedor desativado')

    // Ao recarregar, o fornecedor só vê o aviso. Nada do app.
    await phone.reload()
    await expect(phone.getByRole('alert')).toContainText('Sua conta foi desativada')
    await expect(phone.getByRole('heading', { name: 'Reservas', exact: true })).toBeHidden()

    // A vaga voltou: outro fornecedor reserva o mesmo dia.
    const otherPhone = await newPhone(browser, playwright.devices, baseURL)
    await signIn(otherPhone, other.email, other.password)
    await openMarket(otherPhone, market.name)
    await expect(firstFreeDay(otherPhone)).toBeVisible()

    // Reativar devolve o acesso.
    await page.getByRole('button', { name: `Reativar ${supplier.fullName}` }).click()
    await expect(
      page.getByText(`${supplier.fullName} foi reativado e já pode entrar.`),
    ).toBeVisible()
    await phone.reload()
    await expect(phone.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()
  } finally {
    await cleanupBooking(seed.db, market.id, [supplier, other])
    await seed.cleanup()
  }
})

test.describe('cadastro pela página', () => {
  const created: string[] = []

  test.afterEach(async () => {
    const supabase = localSupabase()
    if (supabase === null) return
    const seed = await seedUsers(supabase)
    await resetSignupState(seed.db)
    await deleteUsersByEmail(seed.db, created.splice(0))
    await seed.cleanup()
  })

  test('fechado (padrão): a página só avisa; com código: o convite funciona e o código antigo morre', async ({
    page,
    browser,
    playwright,
    baseURL,
  }) => {
    const supabase = localSupabase()
    if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
    const seed = await seedUsers(supabase)
    await resetSignupState(seed.db)
    const email = uniqueEmail('convidado')
    const name = `Loja Convidada ${Date.now()}`
    created.push(email)

    try {
      // Fechado: ninguém se cadastra.
      const visitor = await newPhone(browser, playwright.devices, baseURL)
      await visitor.goto('/cadastro')
      await expect(visitor.getByText(/O cadastro está fechado/)).toBeVisible()
      await expect(visitor.getByLabel('E-mail')).toBeHidden()

      // O administrador liga o modo com código.
      await signIn(page, seed.admin.email, seed.admin.password)
      await openAdminTab(page, 'Configurações')
      await expect(page.getByRole('button', { name: 'Fechado' })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await page.getByRole('button', { name: 'Com código' }).click()
      const code = (await page.getByLabel('Código de convite').innerText()).trim()
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
      const inviteUrl = await page
        .getByRole('region', { name: 'Link de convite' })
        .getByLabel('Link')
        .inputValue()
      expect(inviteUrl).toContain(`/cadastro?codigo=${code}`)

      // O convidado abre o link: o código já vem preenchido. Com um dígito trocado, é recusado.
      const guest = await newPhone(browser, playwright.devices, baseURL)
      await guest.goto(inviteUrl)
      await expect(guest.getByLabel('Código de convite')).toHaveValue(code)
      await guest.getByLabel('Nome ou empresa').fill(name)
      await guest.getByLabel('E-mail').fill(email)
      await guest.getByLabel('Escolha uma senha').fill(PASSWORD)
      await guest.getByLabel('Código de convite').fill('AAAA-AAAA')
      await guest.getByRole('button', { name: 'Criar conta' }).click()
      await expect(guest.getByRole('alert')).toContainText('Esse código não vale')

      // Com o código certo, cria a conta e já entra.
      await guest.getByLabel('Código de convite').fill(code)
      await guest.getByRole('button', { name: 'Criar conta' }).click()
      await expect(guest.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()
      await expect(guest.getByText(`${name} · Fornecedor`)).toBeVisible()

      // O administrador gera outro código: o link antigo deixa de valer.
      await page.getByRole('button', { name: 'Gerar novo código' }).click()
      await page.getByRole('button', { name: 'Sim, gerar novo código' }).click()
      await expect(page.getByText('Novo código gerado. O anterior deixou de valer.')).toBeVisible()
      const newCode = (await page.getByLabel('Código de convite').innerText()).trim()
      expect(newCode).not.toBe(code)

      const late = await newPhone(browser, playwright.devices, baseURL)
      await late.goto(inviteUrl)
      const lateEmail = uniqueEmail('atrasado')
      await late.getByLabel('Nome ou empresa').fill('Loja Atrasada')
      await late.getByLabel('E-mail').fill(lateEmail)
      await late.getByLabel('Escolha uma senha').fill(PASSWORD)
      await late.getByRole('button', { name: 'Criar conta' }).click()
      await expect(late.getByRole('alert')).toContainText('Esse código não vale')
      const none = await seed.db.from('profiles').select('id').eq('email', lateEmail)
      expect(none.data).toEqual([])

      // Quem já tinha entrado continua com acesso.
      const again = await newPhone(browser, playwright.devices, baseURL)
      await signIn(again, email, PASSWORD)
      await expect(again.getByRole('heading', { name: 'Reservas', exact: true })).toBeVisible()
    } finally {
      await seed.cleanup()
    }
  })

  test('livre: qualquer pessoa pede a conta, que fica esperando a confirmação do e-mail', async ({
    page,
    browser,
    playwright,
    baseURL,
  }) => {
    const supabase = localSupabase()
    if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
    const seed = await seedUsers(supabase)
    await resetSignupState(seed.db)
    const email = uniqueEmail('livre')
    created.push(email)

    try {
      await signIn(page, seed.admin.email, seed.admin.password)
      await openAdminTab(page, 'Configurações')
      await page.getByRole('button', { name: 'Livre' }).click()
      await expect(page.getByRole('note')).toContainText('qualquer pessoa na internet')

      const visitor = await newPhone(browser, playwright.devices, baseURL)
      await visitor.goto('/cadastro')
      await expect(visitor.getByLabel('Código de convite')).toBeHidden()
      await visitor.getByLabel('Nome ou empresa').fill('Loja Livre')
      await visitor.getByLabel('E-mail').fill(email)
      await visitor.getByLabel('Escolha uma senha').fill(PASSWORD)
      await visitor.getByRole('button', { name: 'Criar conta' }).click()
      await expect(visitor.getByRole('status')).toContainText(`Enviamos uma mensagem para ${email}`)

      // Sem confirmar o e-mail não entra.
      await signIn(visitor, email, PASSWORD)
      await expect(visitor.getByRole('heading', { name: 'Reservas', exact: true })).toBeHidden()
    } finally {
      await seed.cleanup()
    }
  })
})
