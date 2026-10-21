import { SYNC_REJECTION_CODES, type OfflineEvent, type SyncRejectionCode } from '@/domain/sync'
import { VISIT_ORIGINS, VISIT_STATUSES, type Visit, type VisitStatus } from '@/domain/types'
import type { Json, Tables } from '@/lib/database.types'
import { SyncFailure } from './errors'
import { visitFromRow } from './mappers'

/**
 * O que vai e o que volta de `sync_visit_events_v1`. A resposta é JSON solto do banco, então cada
 * campo é conferido aqui antes de virar tipo do domínio: um app antigo diante de um servidor mais
 * novo (ou o contrário) falha de forma explicável em vez de espalhar `undefined` pela tela.
 */

/** Um evento como a função do servidor o lê. */
export type WireEvent = {
  client_event_id: string
  seq: number
  visit_id: string
  type: OfflineEvent['type']
  occurred_at: string
  note?: string
  reason?: string
  caused_by?: string
}

export function toWireEvent(event: OfflineEvent): WireEvent {
  const wire: WireEvent = {
    client_event_id: event.clientEventId,
    seq: event.seq,
    visit_id: event.visitId,
    type: event.type,
    occurred_at: event.occurredAt,
  }
  if (event.causedBy !== undefined) wire.caused_by = event.causedBy
  switch (event.type) {
    case 'checkIn':
      break
    case 'checkOut':
      if (event.note !== undefined) wire.note = event.note
      break
    case 'markNotDone':
      wire.reason = event.reason
      break
  }
  return wire
}

/** `UNRECOGNIZED`: um servidor mais novo recusou por um motivo que este app ainda não conhece. */
export type RejectionCode = SyncRejectionCode | 'UNRECOGNIZED'

export interface EventResult {
  clientEventId: string
  /** null quando o servidor nem chegou a achar a visita (dado ilegível). */
  visitId: string | null
  status: 'applied' | 'rejected'
  /** Só nos recusados. */
  code: RejectionCode | null
  /** Como a visita está no servidor agora: é o que a tela usa para explicar a recusa. */
  visitStatus: VisitStatus | null
  /** true quando o servidor já tinha decidido este evento antes (reenvio). */
  duplicate: boolean
}

export type SyncResponse =
  | {
      kind: 'synced'
      /** Hora do servidor ao responder, para medir quanto o relógio do aparelho está errado. */
      serverNow: string
      /** Um por evento enviado, na ordem em que o servidor os processou (por seq). */
      results: EventResult[]
      /** As visitas do repositor tocadas pelo lote, como ficaram no servidor. */
      visits: Visit[]
    }
  | {
      /** O app é velho demais: nada foi processado e a fila do aparelho continua intacta. */
      kind: 'upgrade_required'
      minClientVersion: string
      serverNow: string
    }

type Obj = Record<string, unknown>

function invalid(what: string): SyncFailure {
  return new SyncFailure('INVALID_RESPONSE', `Resposta da sincronização inválida: ${what}`)
}

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(source: Obj, key: string): string {
  const value = source[key]
  if (typeof value !== 'string') throw invalid(key)
  return value
}

function textOrNull(source: Obj, key: string): string | null {
  const value = source[key]
  if (value === null) return null
  if (typeof value !== 'string') throw invalid(key)
  return value
}

function integer(source: Obj, key: string): number {
  const value = source[key]
  if (typeof value !== 'number' || !Number.isInteger(value)) throw invalid(key)
  return value
}

function oneOf<T extends string>(source: Obj, key: string, allowed: readonly T[]): T {
  const value = text(source, key)
  const found = allowed.find((candidate) => candidate === value)
  if (found === undefined) throw invalid(`${key} "${value}"`)
  return found
}

function instant(source: Obj, key: string): string {
  const value = text(source, key)
  if (Number.isNaN(Date.parse(value))) throw invalid(key)
  return new Date(value).toISOString()
}

function list(source: Obj, key: string): unknown[] {
  const value = source[key]
  if (!Array.isArray(value)) throw invalid(key)
  return value as unknown[]
}

function asObject(value: unknown, what: string): Obj {
  if (!isObject(value)) throw invalid(what)
  return value
}

function visitRow(source: Obj): Tables<'visits'> {
  return {
    id: text(source, 'id'),
    repositor_id: text(source, 'repositor_id'),
    market_id: text(source, 'market_id'),
    visit_date: text(source, 'visit_date'),
    position: integer(source, 'position'),
    status: oneOf(source, 'status', VISIT_STATUSES),
    origin: oneOf(source, 'origin', VISIT_ORIGINS),
    carried_from_date: textOrNull(source, 'carried_from_date'),
    check_in_at: textOrNull(source, 'check_in_at'),
    check_out_at: textOrNull(source, 'check_out_at'),
    note: textOrNull(source, 'note'),
    skip_reason: textOrNull(source, 'skip_reason'),
    created_at: text(source, 'created_at'),
    updated_at: text(source, 'updated_at'),
  }
}

function eventResult(source: Obj): EventResult {
  const status = oneOf(source, 'status', ['applied', 'rejected'] as const)
  const code = textOrNull(source, 'code')
  const visitStatus = textOrNull(source, 'visit_status')
  return {
    clientEventId: text(source, 'client_event_id'),
    visitId: textOrNull(source, 'visit_id'),
    status,
    code:
      status === 'applied'
        ? null
        : (SYNC_REJECTION_CODES.find((known) => known === code) ?? 'UNRECOGNIZED'),
    // Estado que este app não conhece: a tela cai na explicação genérica em vez de quebrar.
    visitStatus: VISIT_STATUSES.find((known) => known === visitStatus) ?? null,
    duplicate: source['duplicate'] === true,
  }
}

export function parseSyncResponse(data: Json | null): SyncResponse {
  const root = asObject(data, 'corpo')
  const serverNow = instant(root, 'server_now')

  if (root['upgrade_required'] === true) {
    return { kind: 'upgrade_required', minClientVersion: text(root, 'min_client_version'), serverNow }
  }

  return {
    kind: 'synced',
    serverNow,
    results: list(root, 'results').map((item) => eventResult(asObject(item, 'results'))),
    visits: list(root, 'visits').map((item) => visitFromRow(visitRow(asObject(item, 'visits')))),
  }
}
