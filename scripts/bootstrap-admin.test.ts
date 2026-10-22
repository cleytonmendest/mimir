import { describe, expect, it } from 'vitest'
import { createFakeSupabase } from '../supabase/functions/_shared/testing.ts'
import { bootstrapAdmin } from './bootstrap-admin.ts'

const input = { email: 'Dono@Loja.com', fullName: 'Maria Souza', appUrl: 'https://agenda.exemplo/' }

describe('bootstrapAdmin', () => {
  it('cria a conta, promove a administradora e devolve o link de ativação', async () => {
    const fake = createFakeSupabase()
    const result = await bootstrapAdmin(fake.deps, input)

    expect(result).toEqual({
      ok: true,
      created: true,
      link: 'https://agenda.exemplo/definir-senha?token=hashed-dono%40loja.com',
    })
    const [profile] = [...fake.profiles.values()]
    expect(profile).toMatchObject({
      email: 'dono@loja.com',
      role: 'admin',
      full_name: 'Maria Souza',
    })
    // A conta nasce confirmada e sem senha: quem define é a própria pessoa, pelo link.
    expect([...fake.users.values()][0]).toMatchObject({ confirmed: true, password: null })
  })

  it('rodar de novo para o mesmo e-mail só gera outro link', async () => {
    const fake = createFakeSupabase()
    await bootstrapAdmin(fake.deps, input)
    const again = await bootstrapAdmin(fake.deps, input)
    expect(again).toMatchObject({ ok: true, created: false })
    expect(fake.users.size).toBe(1)
  })

  it('promove quem já existia como fornecedor', async () => {
    const fake = createFakeSupabase()
    fake.addUser({ email: 'dono@loja.com' })
    const result = await bootstrapAdmin(fake.deps, input)
    expect(result).toMatchObject({ ok: true, created: false })
    expect([...fake.profiles.values()][0]?.role).toBe('admin')
  })

  it('recusa dados inválidos antes de falar com o servidor', async () => {
    const fake = createFakeSupabase()
    expect(await bootstrapAdmin(fake.deps, { ...input, email: 'torto' })).toMatchObject({
      ok: false,
      message: expect.stringContaining('e-mail') as string,
    })
    expect(await bootstrapAdmin(fake.deps, { ...input, fullName: ' ' })).toMatchObject({
      ok: false,
    })
    expect(fake.calls).toEqual([])
  })

  it('não promove nem gera link para conta desativada', async () => {
    const fake = createFakeSupabase()
    fake.addUser({ email: 'dono@loja.com', deactivated: true })
    const result = await bootstrapAdmin(fake.deps, input)
    expect(result).toEqual({
      ok: false,
      message: 'Essa conta está desativada. Reative antes pelo app.',
    })
    expect([...fake.profiles.values()][0]?.role).toBe('supplier')
  })

  it('falha do servidor ao criar a conta vira mensagem', async () => {
    const fake = createFakeSupabase()
    fake.settings.mode = 'closed'
    const original = fake.deps.fetch
    fake.deps.fetch = (request, init) =>
      typeof request === 'string' &&
      request.endsWith('/auth/v1/admin/users') &&
      init?.method === 'POST'
        ? Promise.resolve(
            new Response(JSON.stringify({ error_code: 'weak_password' }), { status: 422 }),
          )
        : original(request, init)
    expect(await bootstrapAdmin(fake.deps, input)).toEqual({
      ok: false,
      message: 'O servidor recusou criar a conta.',
    })
  })
})
