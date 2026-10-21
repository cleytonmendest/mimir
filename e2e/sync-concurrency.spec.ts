import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { expect, test } from '@playwright/test'
import type { Database } from '../src/lib/database.types.ts'
import { seedRepositor } from './support/seed.ts'
import { localSupabase, NO_SUPABASE_MESSAGE } from './support/supabase.ts'

/**
 * A garantia que o pgTAP não alcança (ele roda numa transação só): a função de sincronização
 * contra o Supabase local de verdade, com envios que se cruzam e respostas que se perdem. Fala
 * com a API como o aparelho falaria (RPC), sem abrir o navegador.
 */

const TIME_ZONE = 'America/Sao_Paulo'

/** "AAAA-MM-DD" do instante no fuso da empresa. */
function companyDay(instant: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date(instant))
}

type WireEvent = {
  client_event_id: string
  seq: number
  visit_id: string
  type: 'checkIn' | 'checkOut'
  occurred_at: string
  note?: string
}

type WireResult = {
  client_event_id: string
  status: string
  duplicate: boolean
}

/** Um repositor com `count` visitas de "hoje", cada uma num mercado. */
async function scenario(count: number) {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const seed = await seedRepositor(supabase, 0)

  const startedAt = Date.now() - 120_000
  const unique = randomUUID()
  const markets = await seed.admin
    .from('markets')
    .insert(Array.from({ length: count }, (_, index) => ({ name: `Carga ${unique} ${index}` })))
    .select('id')
  if (markets.error !== null) throw markets.error
  const visits = await seed.admin
    .from('visits')
    .insert(
      markets.data.map((market, position) => ({
        repositor_id: seed.userId,
        market_id: market.id,
        position,
        // O dia do check-in, e não o de agora: o teste não quebra se rodar na virada do dia de Brasília.
        visit_date: companyDay(startedAt),
      })),
    )
    .select('id, position')
    .order('position')
  if (visits.error !== null) throw visits.error
  const visitIds = visits.data.map((visit) => visit.id)

  /** `dropResponses`: o servidor recebe e grava, mas a resposta nunca chega (túnel, elevador...). */
  const control = { dropResponses: false }
  const lossyFetch: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (control.dropResponses && url.includes('/rpc/sync_visit_events_v1')) {
      await response.arrayBuffer()
      throw new TypeError('Failed to fetch')
    }
    return response
  }
  const user = createClient<Database>(supabase.apiUrl, supabase.anonKey, {
    auth: { persistSession: false },
    global: { fetch: lossyFetch },
  })
  const login = await user.auth.signInWithPassword({ email: seed.email, password: seed.password })
  if (login.error !== null) throw login.error

  const deviceId = randomUUID()
  return {
    seed,
    visitIds,
    control,
    deviceId,
    /** Envia como o aparelho: devolve o erro de transporte, se houve, ou os resultados. */
    send: async (events: WireEvent[]) => {
      const { data, error } = await user.rpc('sync_visit_events_v1', {
        p_device_id: deviceId,
        p_client_version: '0.0.0+e2e',
        p_events: events,
      })
      if (error !== null) return { error, results: [] as WireResult[] }
      const body = data as unknown as { results: WireResult[] }
      return { error: null, results: body.results }
    },
    checkIn: (visitId: string, seq: number): WireEvent => {
      return {
        client_event_id: randomUUID(),
        seq,
        visit_id: visitId,
        type: 'checkIn',
        occurred_at: new Date(startedAt + seq).toISOString(),
      }
    },
    checkOut: (visitId: string, seq: number): WireEvent => {
      return {
        client_event_id: randomUUID(),
        seq,
        visit_id: visitId,
        type: 'checkOut',
        occurred_at: new Date(startedAt + 30_000 + seq).toISOString(),
        note: 'Gôndola reposta',
      }
    },
    stored: async () => {
      const events = await seed.admin.from('visit_events').select('id').in('visit_id', visitIds)
      const audit = await seed.admin
        .from('audit_log')
        .select('id')
        .eq('table_name', 'visits')
        .eq('action', 'update')
        .in('row_id', visitIds)
      const current = await seed.admin.from('visits').select('status, note').in('id', visitIds)
      return {
        events: events.data?.length ?? 0,
        updates: audit.data?.length ?? 0,
        visits: current.data ?? [],
      }
    },
    cleanup: async () => {
      await seed.cleanup()
      await seed.admin
        .from('markets')
        .delete()
        .in(
          'id',
          markets.data.map((market) => market.id),
        )
    },
  }
}

test('dez envios simultâneos do mesmo lote de 50 eventos aplicam cada evento uma vez só', async () => {
  const { seed, visitIds, deviceId, send, checkIn, stored, cleanup } = await scenario(50)

  try {
    // Lote cheio: a seção crítica é longa o bastante para os dez envios realmente se cruzarem.
    const events = visitIds.map((visitId, index) => checkIn(visitId, index + 1))
    const responses = await Promise.all(Array.from({ length: 10 }, () => send(events)))

    expect(responses.map((response) => response.error)).toEqual(Array(10).fill(null))
    const results = responses.flatMap((response) => response.results)
    expect(results.filter((result) => result.status !== 'applied')).toEqual([])
    for (const event of events) {
      const ofEvent = results.filter((result) => result.client_event_id === event.client_event_id)
      expect(ofEvent).toHaveLength(10)
      // Um dos dez fez de verdade; os outros nove só receberam o resultado já decidido.
      expect(ofEvent.filter((result) => !result.duplicate)).toHaveLength(1)
    }

    const after = await stored()
    expect(after.events).toBe(50)
    expect(after.updates).toBe(50)
    expect(after.visits.every((visit) => visit.status === 'in_progress')).toBe(true)
    const devices = await seed.admin
      .from('device_status')
      .select('device_id')
      .eq('user_id', seed.userId)
    expect(devices.data).toEqual([{ device_id: deviceId }])
  } finally {
    await cleanup()
  }
})

test('a resposta se perde depois de o servidor gravar: reenviar não duplica nada', async () => {
  const { visitIds, control, send, checkIn, checkOut, stored, cleanup } = await scenario(1)

  try {
    const visitId = visitIds[0] ?? ''
    const events = [checkIn(visitId, 1), checkOut(visitId, 2)]

    // O servidor recebe, grava e responde; a resposta não chega ao aparelho.
    control.dropResponses = true
    const lost = await send(events)
    expect(lost.error).toMatchObject({ message: expect.stringContaining('Failed to fetch') })

    const written = await stored()
    expect(written.events).toBe(2)
    expect(written.visits).toMatchObject([{ status: 'done' }])

    // O aparelho não sabe de nada e reenvia: o servidor devolve o que já tinha decidido.
    control.dropResponses = false
    const retry = await send(events)

    expect(retry.error).toBeNull()
    expect(retry.results.map((result) => [result.status, result.duplicate])).toEqual([
      ['applied', true],
      ['applied', true],
    ])

    const after = await stored()
    expect(after.events).toBe(2)
    expect(after.updates).toBe(2)
  } finally {
    await cleanup()
  }
})

test('sem sessão o servidor recusa o envio inteiro e nada é gravado', async () => {
  const supabase = localSupabase()
  if (supabase === null) throw new Error(NO_SUPABASE_MESSAGE)
  const anonymous = createClient<Database>(supabase.apiUrl, supabase.anonKey, {
    auth: { persistSession: false },
  })

  const { error, status } = await anonymous.rpc('sync_visit_events_v1', {
    p_device_id: randomUUID(),
    p_client_version: '0.0.0+e2e',
    p_events: [],
  })

  expect(error).not.toBeNull()
  expect([401, 403]).toContain(status)
})
