// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createFakeSupabase, post } from '../testing.ts'
import { handleSignupStatus } from './signup-status.ts'

describe('signup-status', () => {
  it.each(['closed', 'invite', 'open'] as const)('devolve o modo %s e nada mais', async (mode) => {
    const fake = createFakeSupabase()
    fake.settings.mode = mode
    fake.settings.invite_code = 'K7QD4MXA'
    const response = await handleSignupStatus(post({}), fake.deps)
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ mode })
    expect(text).not.toContain('K7QD')
  })

  it('não guarda resposta em cache', async () => {
    const fake = createFakeSupabase()
    const response = await handleSignupStatus(post({}), fake.deps)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('502 quando o servidor não responde', async () => {
    const fake = createFakeSupabase()
    fake.faults.network = true
    expect((await handleSignupStatus(post({}), fake.deps)).status).toBe(502)
  })
})
