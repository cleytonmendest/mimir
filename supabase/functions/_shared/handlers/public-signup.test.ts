// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, post } from '../testing.ts'
import {
  handlePublicSignup,
  MAX_ATTEMPTS_PER_EMAIL_PER_HOUR,
  MAX_ATTEMPTS_PER_IP_PER_HOUR,
} from './public-signup.ts'

const person = { email: 'Nova@Loja.com', fullName: 'Loja Nova', password: 'uma-senha-bem-longa' }
const HOUR = 60 * 60 * 1000

function setup(mode: 'closed' | 'invite' | 'open') {
  const fake = createFakeSupabase()
  fake.settings.mode = mode
  fake.settings.invite_code = mode === 'closed' ? null : 'K7QD4MXA'
  return fake
}

async function signup(fake: ReturnType<typeof setup>, body: unknown, ip = '203.0.113.7') {
  const response = await handlePublicSignup(post(body, { ip }), fake.deps)
  return { status: response.status, body: (await response.json()) as Record<string, unknown> }
}

describe('cadastro fechado', () => {
  it('recusa todo mundo, mesmo com um código', async () => {
    const fake = setup('closed')
    const result = await signup(fake, { ...person, code: 'K7QD-4MXA' })
    expect(result.status).toBe(403)
    expect(result.body['error']).toBe('SIGNUP_CLOSED')
    expect(fake.users.size).toBe(0)
    expect(fake.attempts.map((a) => a.outcome)).toEqual(['closed'])
  })
})

describe('cadastro com código de convite', () => {
  it('cria a conta confirmada com o código certo, em qualquer formato', async () => {
    for (const code of ['K7QD4MXA', 'k7qd-4mxa', ' K7QD 4MXA\n']) {
      const fake = setup('invite')
      const result = await signup(fake, { ...person, code })
      expect(result.status).toBe(201)
      expect(result.body).toEqual({ status: 'CREATED' })
      const [user] = [...fake.users.values()]
      expect(user).toMatchObject({
        email: 'nova@loja.com',
        confirmed: true,
        password: 'uma-senha-bem-longa',
        fullName: 'Loja Nova',
      })
      expect(fake.profiles.get(user?.id ?? '')?.role).toBe('supplier')
    }
  })

  it.each([
    ['sem código', undefined],
    ['com código errado', 'AAAA-AAAA'],
    ['com código parecido', 'K7QD-4MXB'],
    ['com código vazio', ''],
  ])('recusa %s', async (_name, code) => {
    const fake = setup('invite')
    const result = await signup(fake, { ...person, ...(code === undefined ? {} : { code }) })
    expect(result.status).toBe(403)
    expect(result.body['error']).toBe('INVALID_CODE')
    expect(fake.users.size).toBe(0)
    expect(fake.attempts.map((a) => a.outcome)).toEqual(['wrong_code'])
  })

  it('sem código gerado, ninguém entra (nem com código vazio)', async () => {
    const fake = setup('invite')
    fake.settings.invite_code = null
    expect((await signup(fake, { ...person, code: '' })).status).toBe(403)
    expect(fake.users.size).toBe(0)
  })

  it('e-mail já cadastrado: 409', async () => {
    const fake = setup('invite')
    fake.addUser({ email: 'nova@loja.com' })
    const result = await signup(fake, { ...person, code: 'K7QD4MXA' })
    expect(result.status).toBe(409)
    expect(result.body['error']).toBe('EMAIL_EXISTS')
  })

  it('senha fraca recusada pelo Auth: 422', async () => {
    const fake = setup('invite')
    const result = await signup(fake, {
      ...person,
      password: 'senha-fraquissima',
      code: 'K7QD4MXA',
    })
    expect(result.status).toBe(422)
    expect(result.body['error']).toBe('WEAK_PASSWORD')
    expect(fake.users.size).toBe(0)
  })

  it('o papel nunca vem do pedido', async () => {
    const fake = setup('invite')
    await signup(fake, { ...person, code: 'K7QD4MXA', role: 'admin', is_admin: true })
    const [profile] = [...fake.profiles.values()]
    expect(profile?.role).toBe('supplier')
  })
})

describe('cadastro livre', () => {
  it('cria a conta SEM confirmar e pede o e-mail de confirmação', async () => {
    const fake = setup('open')
    const result = await signup(fake, person)
    expect(result.status).toBe(202)
    expect(result.body).toEqual({ status: 'CONFIRM_EMAIL' })
    const [user] = [...fake.users.values()]
    expect(user?.confirmed).toBe(false)
    expect(fake.calls).toContain('POST /auth/v1/resend')
  })

  it('e-mail já cadastrado responde igual, para não revelar quem é cliente', async () => {
    const fake = setup('open')
    fake.addUser({ email: 'nova@loja.com' })
    const result = await signup(fake, person)
    expect(result.status).toBe(202)
    expect(result.body).toEqual({ status: 'CONFIRM_EMAIL' })
    expect(fake.calls).not.toContain('POST /auth/v1/resend')
    expect(fake.users.size).toBe(1)
  })
})

describe('entrada inválida', () => {
  it.each([
    ['corpo que não é JSON', null, 400],
    ['sem nome', { ...person, fullName: '' }, 400],
    ['com e-mail torto', { ...person, email: 'x' }, 400],
    ['com senha curta', { ...person, password: 'curta' }, 422],
    ['sem senha', { email: person.email, fullName: person.fullName }, 422],
  ])('%s', async (_name, body, status) => {
    const fake = setup('open')
    const response = await handlePublicSignup(
      post(body, { ip: '203.0.113.7', ...(body === null ? { raw: 'oi' } : {}) }),
      fake.deps,
    )
    expect(response.status).toBe(status)
    expect(fake.users.size).toBe(0)
    expect(fake.attempts).toHaveLength(0)
  })
})

describe('limite de tentativas', () => {
  it('guarda só hash do IP e do e-mail', async () => {
    const fake = setup('invite')
    await signup(fake, { ...person, code: 'errado1' }, '203.0.113.7')
    const stored = JSON.stringify(fake.attempts)
    expect(stored).not.toContain('203.0.113.7')
    expect(stored).not.toContain('nova@loja.com')
    expect(fake.attempts[0]?.ip_hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('bloqueia o IP que passou do limite, mas não outro IP', async () => {
    const fake = setup('invite')
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_IP_PER_HOUR; attempt += 1) {
      const result = await signup(fake, {
        ...person,
        email: `x${attempt}@loja.com`,
        code: 'ERRADO12',
      })
      expect(result.status).toBe(403)
    }
    const blocked = await signup(fake, { ...person, email: 'outro@loja.com', code: 'K7QD4MXA' })
    expect(blocked.status).toBe(429)
    expect(blocked.body['error']).toBe('RATE_LIMITED')
    expect(fake.users.size).toBe(0)

    const elsewhere = await signup(fake, { ...person, code: 'K7QD4MXA' }, '198.51.100.9')
    expect(elsewhere.status).toBe(201)
  })

  it('bloqueia o e-mail que passou do limite, mesmo trocando de IP', async () => {
    const fake = setup('invite')
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_EMAIL_PER_HOUR; attempt += 1) {
      await signup(fake, { ...person, code: 'ERRADO12' }, `192.0.2.${attempt}`)
    }
    const blocked = await signup(fake, { ...person, code: 'K7QD4MXA' }, '192.0.2.200')
    expect(blocked.status).toBe(429)
  })

  it('a contagem olha só a última hora', async () => {
    const fake = setup('invite')
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_EMAIL_PER_HOUR; attempt += 1) {
      await signup(fake, { ...person, code: 'ERRADO12' })
    }
    fake.advance(HOUR + 1000)
    expect((await signup(fake, { ...person, code: 'K7QD4MXA' })).status).toBe(201)
  })

  it('cadastro bem-sucedido apaga tentativas com mais de uma semana', async () => {
    const fake = setup('invite')
    await signup(fake, { ...person, email: 'velha@loja.com', code: 'ERRADO12' })
    fake.advance(8 * 24 * HOUR)
    await signup(fake, { ...person, code: 'K7QD4MXA' })
    expect(fake.attempts.map((a) => a.outcome)).toEqual(['created'])
  })
})
