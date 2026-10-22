// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, post } from '../testing.ts'
import { handleAdminSupplierLink } from './admin-supplier-link.ts'

function setup() {
  const fake = createFakeSupabase()
  const admin = fake.addUser({ email: 'lia@loja.com', role: 'admin' })
  const supplier = fake.addUser({ email: 'bia@loja.com' })
  const gone = fake.addUser({ email: 'caio@loja.com', deactivated: true })
  return { fake, admin, supplier, gone }
}

describe('admin-supplier-link', () => {
  it('gera o token para um fornecedor ativo', async () => {
    const { fake, admin, supplier } = setup()
    const response = await handleAdminSupplierLink(
      post({ supplierId: supplier.id }, { token: admin.token }),
      fake.deps,
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ token: 'hashed-bia@loja.com' })
  })

  it('401 sem login e 403 para fornecedor', async () => {
    const { fake, supplier } = setup()
    const anonymous = await handleAdminSupplierLink(post({ supplierId: supplier.id }), fake.deps)
    expect(anonymous.status).toBe(401)
    const notAdmin = await handleAdminSupplierLink(
      post({ supplierId: supplier.id }, { token: supplier.token }),
      fake.deps,
    )
    expect(notAdmin.status).toBe(403)
  })

  it('400 para id que não é uuid (nem chega a consultar o banco)', async () => {
    const { fake, admin } = setup()
    const before = fake.calls.length
    for (const supplierId of ['', 'abc', '1; drop table profiles', undefined]) {
      const response = await handleAdminSupplierLink(
        post({ supplierId }, { token: admin.token }),
        fake.deps,
      )
      expect(response.status).toBe(400)
    }
    expect(fake.calls.slice(before).some((call) => call.includes('/profiles'))).toBe(false)
  })

  it('400 para corpo vazio', async () => {
    const { fake, admin } = setup()
    const response = await handleAdminSupplierLink(
      post(null, { token: admin.token, raw: '' }),
      fake.deps,
    )
    expect(response.status).toBe(400)
  })

  it('404 para quem não existe e para quem não é fornecedor', async () => {
    const { fake, admin } = setup()
    const unknown = await handleAdminSupplierLink(
      post({ supplierId: '00000000-0000-4000-8000-999999999999' }, { token: admin.token }),
      fake.deps,
    )
    expect(unknown.status).toBe(404)
    const other = await handleAdminSupplierLink(
      post({ supplierId: admin.id }, { token: admin.token }),
      fake.deps,
    )
    expect(other.status).toBe(404)
  })

  it('409 para fornecedor desativado', async () => {
    const { fake, admin, gone } = setup()
    const response = await handleAdminSupplierLink(
      post({ supplierId: gone.id }, { token: admin.token }),
      fake.deps,
    )
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'DEACTIVATED' })
  })

  it('404 quando o perfil não tem e-mail guardado', async () => {
    const { fake, admin, supplier } = setup()
    const profile = fake.profiles.get(supplier.id)
    if (profile) profile.email = null
    const response = await handleAdminSupplierLink(
      post({ supplierId: supplier.id }, { token: admin.token }),
      fake.deps,
    )
    expect(response.status).toBe(404)
  })
})
