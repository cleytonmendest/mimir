import { DomainError, type DomainErrorCode } from './errors'
import { can } from './permissions'
import type { Actor, IsoDate, Visit, VisitStatus } from './types'

/** Eventos de execução: o que o repositor faz dentro do mercado. */
export type ExecutionEvent =
  | { type: 'checkIn' }
  | { type: 'checkOut'; note?: string }
  | { type: 'markNotDone'; reason: string }

export interface TransitionContext {
  actor: Actor
  /** Instante do evento (ISO 8601). Em eventos offline é a hora em que aconteceu, não a da sincronização. */
  now: string
  /** Data local do repositor no instante do evento. */
  today: IsoDate
}

export type TransitionResult =
  { ok: true; visit: Visit } | { ok: false; code: DomainErrorCode; message: string }

function fail(code: DomainErrorCode, message: string): TransitionResult {
  return { ok: false, code, message }
}

function notAllowedFrom(visit: Visit, event: ExecutionEvent['type']): TransitionResult {
  return fail('INVALID_TRANSITION', `"${event}" não é possível com a visita em "${visit.status}"`)
}

const OPEN_STATUSES: readonly VisitStatus[] = ['planned', 'in_progress']

/** Versão que não lança: usada pela sincronização offline, que precisa seguir em frente quando um evento é recusado. */
export function evaluateTransition(
  visit: Visit,
  event: ExecutionEvent,
  ctx: TransitionContext,
): TransitionResult {
  if (!can(ctx.actor, 'executeVisit', visit)) {
    return fail('FORBIDDEN', `${ctx.actor.role} não pode executar esta visita`)
  }

  switch (event.type) {
    case 'checkIn': {
      if (visit.status !== 'planned') return notAllowedFrom(visit, event.type)
      if (visit.date > ctx.today) return fail('VISIT_IN_FUTURE', 'Visita ainda não é de hoje')
      // Visita de dia que já passou não se inicia: fica para o líder remanejar (ADR 0003).
      if (visit.date < ctx.today) return fail('VISIT_IN_PAST', 'Visita de um dia que já passou')
      return { ok: true, visit: { ...visit, status: 'in_progress', checkInAt: ctx.now } }
    }
    case 'checkOut': {
      if (visit.status !== 'in_progress') return notAllowedFrom(visit, event.type)
      if (visit.checkInAt === null || Date.parse(ctx.now) < Date.parse(visit.checkInAt)) {
        return fail('CHECKOUT_BEFORE_CHECKIN', 'Check-out não pode ser antes do check-in')
      }
      return {
        ok: true,
        visit: {
          ...visit,
          status: 'done',
          checkOutAt: ctx.now,
          note: event.note ?? visit.note,
        },
      }
    }
    case 'markNotDone': {
      if (!OPEN_STATUSES.includes(visit.status)) return notAllowedFrom(visit, event.type)
      if (visit.date > ctx.today) return fail('VISIT_IN_FUTURE', 'Visita ainda não é de hoje')
      const reason = event.reason.trim()
      if (reason === '') return fail('REASON_REQUIRED', 'Informe o motivo de não ter ido')
      return { ok: true, visit: { ...visit, status: 'not_done', skipReason: reason } }
    }
  }
}

export function transition(visit: Visit, event: ExecutionEvent, ctx: TransitionContext): Visit {
  const result = evaluateTransition(visit, event, ctx)
  if (!result.ok) throw new DomainError(result.code, result.message)
  return result.visit
}
