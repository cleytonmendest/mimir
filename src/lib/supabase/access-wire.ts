import { SIGNUP_MODES, type SignupMode } from '@/domain/access'
import { RequestFailure } from './errors'
import type { SignupSettings } from './mappers'

/**
 * O que as funções de acesso do banco e as Edge Functions devolvem, validado antes de chegar à
 * tela. Mesmas regras de booking-wire.ts: código de recusa desconhecido vira UNRECOGNIZED; o que
 * não tem a forma esperada é INVALID_RESPONSE.
 */

export const SET_ACTIVE_REFUSALS = ['FORBIDDEN', 'NOT_FOUND'] as const
export type SetActiveRefusal = (typeof SET_ACTIVE_REFUSALS)[number]

export type SetActiveResult =
  | { ok: true; active: boolean; cancelled: number }
  | { ok: false; code: SetActiveRefusal | 'UNRECOGNIZED' }

export const SETTINGS_REFUSALS = ['FORBIDDEN'] as const
export type SettingsRefusal = (typeof SETTINGS_REFUSALS)[number]

export type SettingsResult =
  { ok: true; settings: SignupSettings } | { ok: false; code: SettingsRefusal | 'UNRECOGNIZED' }

function invalid(what: string): RequestFailure {
  return new RequestFailure('INVALID_RESPONSE', `Resposta inesperada do servidor: ${what}`)
}

export function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw invalid(what)
  return value as Record<string, unknown>
}

export function text(value: unknown, what: string): string {
  if (typeof value !== 'string' || value === '') throw invalid(what)
  return value
}

function bool(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw invalid(what)
  return value
}

function count(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw invalid(what)
  return value
}

function refusal<T extends string>(
  body: Record<string, unknown>,
  known: readonly T[],
): { ok: false; code: T | 'UNRECOGNIZED' } {
  const code = text(body['code'], 'code')
  return { ok: false, code: known.find((candidate) => candidate === code) ?? 'UNRECOGNIZED' }
}

export function parseSignupMode(value: unknown): SignupMode {
  const mode = SIGNUP_MODES.find((candidate) => candidate === value)
  if (mode === undefined) throw invalid('mode')
  return mode
}

export function parseSetActiveResult(data: unknown): SetActiveResult {
  const body = record(data, 'set_supplier_active_v1')
  if (!bool(body['ok'], 'ok')) return refusal(body, SET_ACTIVE_REFUSALS)
  return {
    ok: true,
    active: bool(body['active'], 'active'),
    cancelled: count(body['cancelled'], 'cancelled'),
  }
}

/** Resposta de set_signup_mode_v1 e de regenerate_invite_code_v1. */
export function parseSettingsResult(data: unknown): SettingsResult {
  const body = record(data, 'configuração do cadastro')
  if (!bool(body['ok'], 'ok')) return refusal(body, SETTINGS_REFUSALS)
  const code = body['invite_code']
  if (code !== null && typeof code !== 'string') throw invalid('invite_code')
  return { ok: true, settings: { mode: parseSignupMode(body['mode']), inviteCode: code } }
}
