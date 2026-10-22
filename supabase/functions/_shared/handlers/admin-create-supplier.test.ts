// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { ANON_KEY, createFakeSupabase, post } from '../testing.ts'
import { handleAdminCreateSupplier } from './admin-create-supplier.ts'

const input = { email: 'Ana@Loja.com ', fullName: ' Sabor da Serra ' }

function setup() {
  const fake = createFakeSupabase()
  const admin = fake.addUser({ email: 'lia@loja.com', role: 'admin' })
  const supplier = fake.addUser({ email: 'bia@loja.com' })
  return { fake, admin, supplier }
}

describe('admin-create-supplier: quem pode chamar', () => {
  it('responde ao preflight do navegador', async () => {
    const { fake } = setup()
    const response = await handleAdminCreateSupplier(
      new Request('http://x/fn', { method: 'OPTIONS' }),
      fake.deps,
    )
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization')
  })

  it('só aceita POST', async () => {
    const { fake } = setup()
    const response = await handleAdminCreateSupplier(
      new Request('http://x/fn', { method: 'GET' }),
      fake.deps,
    )
    expect(response.status).toBe(405)
  })

  it.each([
    ['sem cabeçalho de login', undefined],
    ['com a chave pública no lugar do login', ANON_KEY],
    ['com um token que não existe', 'token-falso'],
  ])('401 %s', async (_name, token) => {
    const { fake } = setup()
    const response = await handleAdminCreateSupplier(
      post(input, token === undefined ? {} : { token }),
      fake.deps,
    )
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'UNAUTHENTICATED' })
    expect(fake.users.size).toBe(2)
  })

  it('403 para fornecedor logado, e nada é criado', async () => {
    const { fake, supplier } = setup()
    const response = await handleAdminCreateSupplier(
      post(input, { token: supplier.token }),
      fake.deps,
    )
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'FORBIDDEN' })
    expect(fake.users.size).toBe(2)
  })

  it('403 para administrador desativado', async () => {
    const fake = createFakeSupabase()
    const gone = fake.addUser({ email: 'velho@loja.com', role: 'admin', deactivated: true })
    const response = await handleAdminCreateSupplier(post(input, { token: gone.token }), fake.deps)
    expect(response.status).toBe(403)
    expect(fake.users.size).toBe(1)
  })
})

describe('admin-create-supplier: cadastro', () => {
  it('cria o fornecedor confirmado, sem senha, e devolve o token do link', async () => {
    const { fake, admin } = setup()
    const response = await handleAdminCreateSupplier(post(input, { token: admin.token }), fake.deps)

    expect(response.status).toBe(201)
    const body = (await response.json()) as {
      supplier: { id: string; email: string; fullName: string }
      token: string
    }
    expect(body.supplier).toMatchObject({ email: 'ana@loja.com', fullName: 'Sabor da Serra' })
    expect(body.token).toBe('hashed-ana@loja.com')
    const created = fake.users.get(body.supplier.id)
    expect(created).toMatchObject({ confirmed: true, password: null, fullName: 'Sabor da Serra' })
    expect(fake.profiles.get(body.supplier.id)?.role).toBe('supplier')
  })

  it('nunca chama o Auth de administração com a credencial de quem chamou', async () => {
    const { fake, admin } = setup()
    await handleAdminCreateSupplier(post(input, { token: admin.token }), fake.deps)
    // O fake recusa essas rotas sem a chave de serviço; se a função usasse o token do admin, o
    // pedido teria virado 401 e não haveria usuário novo.
    expect(fake.users.size).toBe(3)
  })

  it.each([
    ['sem nome', { email: 'a@b.com', fullName: ' ' }, 'Informe o nome do fornecedor.'],
    ['sem e-mail', { email: '', fullName: 'Ana' }, 'Informe o e-mail.'],
    ['com e-mail torto', { email: 'ana@', fullName: 'Ana' }, /não parece certo/],
  ])('400 %s', async (_name, body, message) => {
    const { fake, admin } = setup()
    const response = await handleAdminCreateSupplier(post(body, { token: admin.token }), fake.deps)
    expect(response.status).toBe(400)
    const parsed = (await response.json()) as { error: string; message: string }
    expect(parsed.error).toBe('INVALID_INPUT')
    expect(parsed.message).toMatch(message)
  })

  it('400 para corpo que não é JSON de objeto', async () => {
    const { fake, admin } = setup()
    for (const raw of ['', 'não é json', '[1,2]', 'x'.repeat(5000)]) {
      const response = await handleAdminCreateSupplier(
        post(null, { token: admin.token, raw }),
        fake.deps,
      )
      expect(response.status).toBe(400)
    }
    expect(fake.users.size).toBe(2)
  })

  it('409 quando o e-mail já tem conta', async () => {
    const { fake, admin } = setup()
    const response = await handleAdminCreateSupplier(
      post({ email: 'bia@loja.com', fullName: 'Outra Bia' }, { token: admin.token }),
      fake.deps,
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'EMAIL_EXISTS' })
  })

  it('se o link falhar, desfaz a conta para o administrador poder tentar de novo', async () => {
    const { fake, admin } = setup()
    fake.faults.generateLink = true
    const response = await handleAdminCreateSupplier(post(input, { token: admin.token }), fake.deps)
    expect(response.status).toBe(502)
    expect([...fake.users.values()].some((user) => user.email === 'ana@loja.com')).toBe(false)
    expect([...fake.profiles.values()].some((row) => row.email === 'ana@loja.com')).toBe(false)
  })

  it('502 quando o servidor de contas não responde, sem vazar detalhe', async () => {
    const { fake, admin } = setup()
    fake.faults.network = true
    const response = await handleAdminCreateSupplier(post(input, { token: admin.token }), fake.deps)
    expect(response.status).toBe(502)
    expect(JSON.stringify(await response.json())).not.toContain('rede fora do ar')
  })
})
