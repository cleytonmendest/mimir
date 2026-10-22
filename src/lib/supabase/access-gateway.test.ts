import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js'
import { describe, expect, it } from 'vitest'
import { createAccessGateway } from './access-gateway'
import type { AppSupabaseClient } from './client'
import { RequestFailure } from './errors'

type Outcome = { data: unknown; error: null } | { data: null; error: unknown }
type DbResult = { data: unknown; error: { message: string; code?: string } | null; status: number }
type Call = [string, ...unknown[]]

/** Cliente falso: as funções devolvem o que o teste manda; o banco registra a consulta montada. */
function fakeClient(options: { invoke?: Outcome; db?: DbResult } = {}) {
  const calls: Call[] = []
  const db = options.db ?? { data: [], error: null, status: 200 }
  const builder: unknown = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'then') return (resolve: (value: DbResult) => void) => resolve(db)
        return (...args: unknown[]) => {
          calls.push([String(property), ...args])
          return builder
        }
      },
    },
  )
  const client = {
    from: (table: string) => {
      calls.push(['from', table])
      return builder
    },
    rpc: (name: string, args: unknown) => {
      calls.push(['rpc', name, args])
      return builder
    },
    functions: {
      invoke: (name: string, init: unknown) => {
        calls.push(['invoke', name, init])
        return Promise.resolve(options.invoke ?? { data: {}, error: null })
      },
    },
  } as unknown as AppSupabaseClient
  return { gateway: createAccessGateway(() => client), calls }
}

const httpError = (status: number, body: unknown): Outcome => ({
  data: null,
  error: new FunctionsHttpError(
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }),
  ),
})
const success = (data: unknown): Outcome => ({ data, error: null })

describe('listSuppliers', () => {
  it('lê só os fornecedores, por nome', async () => {
    const { gateway, calls } = fakeClient({
      db: {
        data: [
          { id: 'u-1', full_name: 'Ana', email: 'ana@x.com', deactivated_at: null },
          { id: 'u-2', full_name: 'Bia', email: null, deactivated_at: '2026-10-21T10:00:00Z' },
        ],
        error: null,
        status: 200,
      },
    })
    expect(await gateway.listSuppliers()).toEqual([
      { id: 'u-1', fullName: 'Ana', email: 'ana@x.com', active: true },
      { id: 'u-2', fullName: 'Bia', email: '', active: false },
    ])
    expect(calls).toContainEqual(['eq', 'role', 'supplier'])
    expect(calls).toContainEqual(['order', 'full_name'])
  })

  it('erro do servidor vira RequestFailure', async () => {
    const { gateway } = fakeClient({
      db: { data: null, error: { message: 'boom' }, status: 500 },
    })
    await expect(gateway.listSuppliers()).rejects.toMatchObject({ code: 'SERVER' })
  })
})

describe('createSupplier', () => {
  const input = { email: 'ana@loja.com', fullName: 'Ana' }

  it('cria e devolve o fornecedor com o token do link', async () => {
    const { gateway, calls } = fakeClient({
      invoke: success({
        supplier: { id: 'u-1', email: 'ana@loja.com', fullName: 'Ana' },
        token: 'tok',
      }),
    })
    expect(await gateway.createSupplier(input)).toEqual({
      ok: true,
      token: 'tok',
      supplier: { id: 'u-1', email: 'ana@loja.com', fullName: 'Ana', active: true },
    })
    expect(calls[0]).toEqual(['invoke', 'admin-create-supplier', { body: input }])
  })

  it('e-mail repetido e dados inválidos voltam como recusa, com a mensagem', async () => {
    const duplicated = fakeClient({
      invoke: httpError(409, { error: 'EMAIL_EXISTS', message: 'Já existe.' }),
    })
    expect(await duplicated.gateway.createSupplier(input)).toEqual({
      ok: false,
      code: 'EMAIL_EXISTS',
      message: 'Já existe.',
    })
    const invalid = fakeClient({ invoke: httpError(400, { error: 'INVALID_INPUT' }) })
    expect(await invalid.gateway.createSupplier(input)).toEqual({
      ok: false,
      code: 'INVALID_INPUT',
      message: '',
    })
  })

  it('sem login ou sem ser administrador vira falha de sessão', async () => {
    for (const [status, error] of [
      [401, 'UNAUTHENTICATED'],
      [403, 'FORBIDDEN'],
    ] as const) {
      const { gateway } = fakeClient({ invoke: httpError(status, { error }) })
      await expect(gateway.createSupplier(input)).rejects.toMatchObject({ code: 'AUTH' })
    }
  })

  it('recusa que o app não conhece é falha, não resultado', async () => {
    const { gateway } = fakeClient({ invoke: httpError(422, { error: 'NOVA' }) })
    await expect(gateway.createSupplier(input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('resposta de sucesso fora da forma é INVALID_RESPONSE', async () => {
    const { gateway } = fakeClient({ invoke: success({ supplier: {}, token: 'x' }) })
    await expect(gateway.createSupplier(input)).rejects.toBeInstanceOf(RequestFailure)
  })

  it('classifica sem rede, gateway fora do ar e erro 5xx', async () => {
    const offline = fakeClient({
      invoke: { data: null, error: new FunctionsFetchError(new TypeError('fetch failed')) },
    })
    await expect(offline.gateway.createSupplier(input)).rejects.toMatchObject({ code: 'NETWORK' })

    const relay = fakeClient({
      invoke: { data: null, error: new FunctionsRelayError(new Error('relay')) },
    })
    await expect(relay.gateway.createSupplier(input)).rejects.toMatchObject({ code: 'SERVER' })

    const broken = fakeClient({ invoke: httpError(502, { error: 'UPSTREAM' }) })
    await expect(broken.gateway.createSupplier(input)).rejects.toMatchObject({ code: 'SERVER' })

    const html = fakeClient({ invoke: httpError(500, '<html>erro</html>') })
    await expect(html.gateway.createSupplier(input)).rejects.toMatchObject({ code: 'SERVER' })

    const strange = fakeClient({ invoke: { data: null, error: new Error('???') } })
    await expect(strange.gateway.createSupplier(input)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    })
  })

  it('403 com corpo que não é de recusa de acesso volta como recusa desconhecida', async () => {
    const { gateway } = fakeClient({ invoke: httpError(403, 'texto solto') })
    await expect(gateway.createSupplier(input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })
})

describe('supplierLink', () => {
  it('devolve o token', async () => {
    const { gateway, calls } = fakeClient({ invoke: success({ token: 'tok' }) })
    expect(await gateway.supplierLink('u-1')).toEqual({ ok: true, token: 'tok' })
    expect(calls[0]).toEqual(['invoke', 'admin-supplier-link', { body: { supplierId: 'u-1' } }])
  })

  it('desativado e inexistente são recusas', async () => {
    const off = fakeClient({ invoke: httpError(409, { error: 'DEACTIVATED' }) })
    expect(await off.gateway.supplierLink('u-1')).toEqual({ ok: false, code: 'DEACTIVATED' })
    const gone = fakeClient({ invoke: httpError(404, { error: 'NOT_FOUND' }) })
    expect(await gone.gateway.supplierLink('u-1')).toEqual({ ok: false, code: 'NOT_FOUND' })
  })

  it('outra recusa é falha', async () => {
    const { gateway } = fakeClient({ invoke: httpError(400, { error: 'INVALID_INPUT' }) })
    await expect(gateway.supplierLink('u-1')).rejects.toBeInstanceOf(RequestFailure)
  })
})

describe('desativar e reativar', () => {
  it('chama set_supplier_active_v1 e valida a resposta', async () => {
    const { gateway, calls } = fakeClient({
      db: { data: { ok: true, active: false, cancelled: 3 }, error: null, status: 200 },
    })
    expect(await gateway.setSupplierActive('u-1', false)).toEqual({
      ok: true,
      active: false,
      cancelled: 3,
    })
    expect(calls).toContainEqual([
      'rpc',
      'set_supplier_active_v1',
      { p_supplier: 'u-1', p_active: false },
    ])
  })

  it('erro de rede do banco vira RequestFailure', async () => {
    const { gateway } = fakeClient({ db: { data: null, error: { message: 'x' }, status: 0 } })
    await expect(gateway.setSupplierActive('u-1', true)).rejects.toMatchObject({ code: 'NETWORK' })
  })
})

describe('configuração do cadastro', () => {
  it('lê o modo e o código', async () => {
    const { gateway } = fakeClient({
      db: { data: { mode: 'invite', invite_code: 'K7QD4MXA' }, error: null, status: 200 },
    })
    expect(await gateway.signupSettings()).toEqual({ mode: 'invite', inviteCode: 'K7QD4MXA' })
  })

  it('muda o modo e gera novo código pelas funções do banco', async () => {
    const reply = { ok: true, mode: 'invite', invite_code: 'K7QD4MXA' }
    const { gateway, calls } = fakeClient({ db: { data: reply, error: null, status: 200 } })
    expect(await gateway.setSignupMode('invite')).toEqual({
      ok: true,
      settings: { mode: 'invite', inviteCode: 'K7QD4MXA' },
    })
    await gateway.regenerateInviteCode()
    expect(calls).toContainEqual(['rpc', 'set_signup_mode_v1', { p_mode: 'invite' }])
    expect(calls.some((call) => call[1] === 'regenerate_invite_code_v1')).toBe(true)
  })

  it('erro do servidor vira RequestFailure', async () => {
    const { gateway } = fakeClient({ db: { data: null, error: { message: 'x' }, status: 500 } })
    await expect(gateway.signupSettings()).rejects.toMatchObject({ code: 'SERVER' })
    await expect(gateway.setSignupMode('open')).rejects.toMatchObject({ code: 'SERVER' })
    await expect(gateway.regenerateInviteCode()).rejects.toMatchObject({ code: 'SERVER' })
  })
})

describe('páginas públicas', () => {
  it('signup-status devolve o modo', async () => {
    const { gateway } = fakeClient({ invoke: success({ mode: 'open' }) })
    expect(await gateway.signupStatus()).toBe('open')
  })

  it('signup-status com erro é falha', async () => {
    const { gateway } = fakeClient({ invoke: httpError(400, { error: 'X' }) })
    await expect(gateway.signupStatus()).rejects.toBeInstanceOf(RequestFailure)
  })

  const input = { email: 'a@b.com', fullName: 'A', password: 'uma-senha-longa', code: 'K7QD4MXA' }

  it('cadastro com sucesso nos dois jeitos', async () => {
    const created = fakeClient({ invoke: success({ status: 'CREATED' }) })
    expect(await created.gateway.signUp(input)).toEqual({ ok: true, status: 'CREATED' })
    expect(created.calls[0]).toEqual(['invoke', 'public-signup', { body: input }])
    const confirm = fakeClient({ invoke: success({ status: 'CONFIRM_EMAIL' }) })
    expect(await confirm.gateway.signUp(input)).toEqual({ ok: true, status: 'CONFIRM_EMAIL' })
  })

  it('resposta de sucesso inesperada é INVALID_RESPONSE', async () => {
    const { gateway } = fakeClient({ invoke: success({ status: 'TALVEZ' }) })
    await expect(gateway.signUp(input)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it.each([
    [403, 'SIGNUP_CLOSED'],
    [403, 'INVALID_CODE'],
    [409, 'EMAIL_EXISTS'],
    [422, 'WEAK_PASSWORD'],
    [429, 'RATE_LIMITED'],
    [400, 'INVALID_INPUT'],
  ])('recusa %i %s volta como resultado, com a mensagem do servidor', async (status, error) => {
    const { gateway } = fakeClient({ invoke: httpError(status, { error, message: 'Texto.' }) })
    expect(await gateway.signUp(input)).toEqual({ ok: false, code: error, message: 'Texto.' })
  })

  it('recusa desconhecida e sem mensagem', async () => {
    const { gateway } = fakeClient({ invoke: httpError(418, { error: 'CHA' }) })
    expect(await gateway.signUp(input)).toEqual({ ok: false, code: 'UNRECOGNIZED', message: null })
  })
})
