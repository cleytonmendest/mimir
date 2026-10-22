import { expect, test } from '@playwright/test'
import {
  accessTokenFor,
  callFunction,
  clientFor,
  deleteUsersByEmail,
  resetSignupState,
  uniqueEmail,
} from './support/functions.ts'
import { seedUsers, type SeededUsers } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'

/**
 * As Edge Functions de acesso contra o Supabase local de verdade: quem pode chamar, o link de
 * ativação, o cadastro público nos três modos e o limite de tentativas. Sem navegador.
 */
const supabase = localSupabase()

const PASSWORD = 'uma-senha-bem-longa'

let seed: SeededUsers
let adminToken: string
const created: string[] = []

test.beforeEach(async () => {
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  seed = await seedUsers(supabase)
  await resetSignupState(seed.db)
  adminToken = await accessTokenFor(supabase, seed.admin)
})

test.afterEach(async () => {
  await resetSignupState(seed.db)
  await deleteUsersByEmail(seed.db, created.splice(0))
  await seed.cleanup()
})

function need(): NonNullable<typeof supabase> {
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  return supabase
}

test.describe('quem pode chamar as funções do administrador', () => {
  for (const name of ['admin-create-supplier', 'admin-supplier-link']) {
    test(`${name}: 401 sem login e só com a chave pública`, async () => {
      const body = { email: uniqueEmail('x'), fullName: 'X', supplierId: seed.supplier.userId }
      const anonymous = await callFunction(need(), name, { body })
      expect(anonymous.status).toBe(401)
      expect(anonymous.body['error']).toBe('UNAUTHENTICATED')
    })

    test(`${name}: 403 para fornecedor logado`, async () => {
      const token = await accessTokenFor(need(), seed.supplier)
      const body = { email: uniqueEmail('x'), fullName: 'X', supplierId: seed.supplier.userId }
      const reply = await callFunction(need(), name, { token, body })
      expect(reply.status).toBe(403)
      expect(reply.body['error']).toBe('FORBIDDEN')
    })

    test(`${name}: 403 para administrador desativado`, async () => {
      // Já com o token em mãos: o token continua válido, mas a conta não vale mais.
      await seed.db
        .from('profiles')
        .update({ deactivated_at: new Date().toISOString() })
        .eq('id', seed.admin.userId)
      const body = { email: uniqueEmail('x'), fullName: 'X', supplierId: seed.supplier.userId }
      const reply = await callFunction(need(), name, { token: adminToken, body })
      expect(reply.status).toBe(403)
    })
  }

  test('o preflight do navegador é respondido com CORS', async () => {
    const reply = await callFunction(need(), 'admin-create-supplier', { method: 'OPTIONS' })
    expect(reply.status).toBe(204)
    expect(reply.headers.get('access-control-allow-origin')).toBe('*')
    expect(reply.headers.get('access-control-allow-headers')).toContain('authorization')
  })

  test('fornecedor que tenta cadastrar não cria nada', async () => {
    const email = uniqueEmail('intruso')
    const token = await accessTokenFor(need(), seed.supplier)
    await callFunction(need(), 'admin-create-supplier', { token, body: { email, fullName: 'I' } })
    const found = await seed.db.from('profiles').select('id').eq('email', email)
    expect(found.data).toEqual([])
  })
})

test.describe('cadastro pelo administrador e link de ativação', () => {
  test('o fornecedor define a senha pelo link, entra, e o link só vale uma vez', async () => {
    const email = uniqueEmail('novo')
    created.push(email)
    const reply = await callFunction(need(), 'admin-create-supplier', {
      token: adminToken,
      body: { email, fullName: 'Sabor da Serra' },
    })
    expect(reply.status).toBe(201)
    const token = reply.body['token'] as string
    expect(reply.body['supplier']).toMatchObject({ email, fullName: 'Sabor da Serra' })

    // Antes de ativar não dá para entrar: a conta não tem senha.
    const early = await clientFor(need()).then((c) =>
      c.auth.signInWithPassword({ email, password: PASSWORD }),
    )
    expect(early.error).not.toBeNull()

    // O link vira uma sessão, e nela a pessoa define a senha.
    const supplier = await clientFor(need())
    const redeemed = await supplier.auth.verifyOtp({ token_hash: token, type: 'recovery' })
    expect(redeemed.error).toBeNull()
    expect(redeemed.data.user?.email).toBe(email)
    const updated = await supplier.auth.updateUser({ password: PASSWORD })
    expect(updated.error).toBeNull()

    // Entra com a senha nova, e é fornecedor (nunca administrador).
    const fresh = await clientFor(need(), { email, password: PASSWORD })
    const profile = await fresh.from('profiles').select('role, full_name, email').single()
    expect(profile.data).toEqual({ role: 'supplier', full_name: 'Sabor da Serra', email })

    // Segunda vez: o link já foi usado.
    const again = await clientFor(need()).then((c) =>
      c.auth.verifyOtp({ token_hash: token, type: 'recovery' }),
    )
    expect(again.error).not.toBeNull()
  })

  test('e-mail repetido e dados inválidos são recusados com mensagem', async () => {
    const duplicated = await callFunction(need(), 'admin-create-supplier', {
      token: adminToken,
      body: { email: seed.supplier.email, fullName: 'Outro' },
    })
    expect(duplicated.status).toBe(409)
    expect(duplicated.body['error']).toBe('EMAIL_EXISTS')

    const invalid = await callFunction(need(), 'admin-create-supplier', {
      token: adminToken,
      body: { email: 'sem-arroba', fullName: 'Outro' },
    })
    expect(invalid.status).toBe(400)
    expect(invalid.body['message']).toMatch(/e-mail/i)
  })

  test('novo link para quem perdeu o acesso; desativado não recebe', async () => {
    const link = await callFunction(need(), 'admin-supplier-link', {
      token: adminToken,
      body: { supplierId: seed.supplier.userId },
    })
    expect(link.status).toBe(200)
    const redeemed = await clientFor(need()).then((c) =>
      c.auth.verifyOtp({ token_hash: link.body['token'] as string, type: 'recovery' }),
    )
    expect(redeemed.error).toBeNull()

    const admin = await clientFor(need(), seed.admin)
    const off = await admin.rpc('set_supplier_active_v1', {
      p_supplier: seed.supplier.userId,
      p_active: false,
    })
    expect(off.data).toMatchObject({ ok: true, active: false })

    const blocked = await callFunction(need(), 'admin-supplier-link', {
      token: adminToken,
      body: { supplierId: seed.supplier.userId },
    })
    expect(blocked.status).toBe(409)
    expect(blocked.body['error']).toBe('DEACTIVATED')

    const missing = await callFunction(need(), 'admin-supplier-link', {
      token: adminToken,
      body: { supplierId: '00000000-0000-4000-8000-000000000000' },
    })
    expect(missing.status).toBe(404)
  })
})

test.describe('cadastro pela página pública', () => {
  async function setMode(mode: 'closed' | 'invite' | 'open') {
    const admin = await clientFor(need(), seed.admin)
    const result = await admin.rpc('set_signup_mode_v1', { p_mode: mode })
    expect(result.error).toBeNull()
    return result.data as { ok: true; mode: string; invite_code: string | null }
  }

  const person = (email: string, code?: string) => ({
    email,
    fullName: 'Loja Nova',
    password: PASSWORD,
    ...(code === undefined ? {} : { code }),
  })

  test('fechado (o padrão): ninguém se cadastra, e a página só fica sabendo o modo', async () => {
    const status = await callFunction(need(), 'signup-status')
    expect(status.body).toEqual({ mode: 'closed' })

    const email = uniqueEmail('fechado')
    const reply = await callFunction(need(), 'public-signup', { body: person(email, 'QUALQUER') })
    expect(reply.status).toBe(403)
    expect(reply.body['error']).toBe('SIGNUP_CLOSED')
    const found = await seed.db.from('profiles').select('id').eq('email', email)
    expect(found.data).toEqual([])
  })

  test('com código: errado é recusado; certo cria a conta e já dá para entrar', async () => {
    const { invite_code: code } = await setMode('invite')
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)

    const status = await callFunction(need(), 'signup-status')
    expect(status.body).toEqual({ mode: 'invite' })
    expect(JSON.stringify(status.body)).not.toContain(code ?? '??')

    const email = uniqueEmail('convite')
    created.push(email)
    const wrong = await callFunction(need(), 'public-signup', { body: person(email, 'AAAA-AAAA') })
    expect(wrong.status).toBe(403)
    expect(wrong.body['error']).toBe('INVALID_CODE')

    const dashed = `${code?.slice(0, 4)}-${code?.slice(4)}`.toLowerCase()
    const ok = await callFunction(need(), 'public-signup', { body: person(email, dashed) })
    expect(ok.status).toBe(201)

    const signedIn = await clientFor(need(), { email, password: PASSWORD })
    const profile = await signedIn.from('profiles').select('role').single()
    expect(profile.data?.role).toBe('supplier')

    // O mesmo e-mail de novo: já existe.
    const again = await callFunction(need(), 'public-signup', { body: person(email, dashed) })
    expect(again.status).toBe(409)
  })

  test('gerar novo código invalida o antigo, e as contas criadas continuam', async () => {
    const { invite_code: first } = await setMode('invite')
    const email = uniqueEmail('antes')
    created.push(email)
    expect(
      (await callFunction(need(), 'public-signup', { body: person(email, first ?? '') })).status,
    ).toBe(201)

    const admin = await clientFor(need(), seed.admin)
    const regenerated = await admin.rpc('regenerate_invite_code_v1')
    const second = (regenerated.data as { invite_code: string }).invite_code
    expect(second).not.toBe(first)

    const stale = await callFunction(need(), 'public-signup', {
      body: person(uniqueEmail('velho'), first ?? ''),
    })
    expect(stale.status).toBe(403)

    const fresh = uniqueEmail('depois')
    created.push(fresh)
    expect(
      (await callFunction(need(), 'public-signup', { body: person(fresh, second) })).status,
    ).toBe(201)

    // Quem entrou com o código antigo segue podendo entrar.
    const stillIn = await clientFor(need(), { email, password: PASSWORD })
    expect((await stillIn.auth.getSession()).data.session).not.toBeNull()
  })

  test('livre: cria a conta SEM confirmar e responde igual para e-mail repetido', async () => {
    await setMode('open')
    const email = uniqueEmail('livre')
    created.push(email)
    const first = await callFunction(need(), 'public-signup', { body: person(email) })
    expect(first.status).toBe(202)
    expect(first.body['status']).toBe('CONFIRM_EMAIL')

    // Sem confirmar o e-mail não entra.
    const early = await clientFor(need()).then((c) =>
      c.auth.signInWithPassword({ email, password: PASSWORD }),
    )
    expect(early.error).not.toBeNull()

    const profile = await seed.db.from('profiles').select('id, role').eq('email', email).single()
    expect(profile.data?.role).toBe('supplier')
    const user = await seed.db.auth.admin.getUserById(profile.data?.id ?? '')
    expect(user.data.user?.email_confirmed_at).toBeFalsy()

    const repeated = await callFunction(need(), 'public-signup', { body: person(email) })
    expect(repeated.status).toBe(202)
    expect(repeated.body['status']).toBe('CONFIRM_EMAIL')
  })

  test('o papel não vem do pedido: quem manda role admin continua fornecedor', async () => {
    const { invite_code: code } = await setMode('invite')
    const email = uniqueEmail('esperto')
    created.push(email)
    const reply = await callFunction(need(), 'public-signup', {
      body: { ...person(email, code ?? ''), role: 'admin', user_metadata: { role: 'admin' } },
    })
    expect(reply.status).toBe(201)
    const profile = await seed.db.from('profiles').select('role').eq('email', email).single()
    expect(profile.data?.role).toBe('supplier')
  })

  test('senha curta e e-mail torto são recusados antes de qualquer coisa', async () => {
    await setMode('open')
    const weak = await callFunction(need(), 'public-signup', {
      body: { ...person(uniqueEmail('fraca')), password: 'curta' },
    })
    expect(weak.status).toBe(422)
    expect(weak.body['error']).toBe('WEAK_PASSWORD')

    const badEmail = await callFunction(need(), 'public-signup', { body: person('sem-arroba') })
    expect(badEmail.status).toBe(400)
  })

  test('o sexto chute no mesmo e-mail leva 429', async () => {
    const { invite_code: code } = await setMode('invite')
    expect(code).not.toBeNull()
    const email = uniqueEmail('chute')
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const reply = await callFunction(need(), 'public-signup', { body: person(email, 'ERRADO12') })
      expect(reply.status).toBe(403)
    }
    // Nem o código certo passa depois do limite.
    const blocked = await callFunction(need(), 'public-signup', { body: person(email, code ?? '') })
    expect(blocked.status).toBe(429)
    expect(blocked.body['error']).toBe('RATE_LIMITED')
    const found = await seed.db.from('profiles').select('id').eq('email', email)
    expect(found.data).toEqual([])
  })
})
