import { NO_CHECKOUT_REASON } from './carryover'
import { DomainError } from './errors'
import { transition, type ExecutionEvent, type TransitionContext } from './status'
import type { Visit } from './types'

export const AUTO_CHECKOUT_NOTE = 'Check-out automático ao iniciar outra visita'

/** As outras visitas abertas do mesmo repositor: o que um novo check-in encerra. */
function openElsewhere(visits: readonly Visit[], target: Visit): Visit[] {
  return visits.filter(
    (visit) =>
      visit.id !== target.id &&
      visit.repositorId === target.repositorId &&
      visit.status === 'in_progress',
  )
}

function findTarget(visits: readonly Visit[], visitId: string): Visit {
  const target = visits.find((visit) => visit.id === visitId)
  if (target === undefined) throw new DomainError('VISIT_NOT_FOUND', `Visita ${visitId} não existe`)
  return target
}

/**
 * Check-in com a regra de "um mercado aberto por vez" do repositor.
 * Se ele esqueceu de sair do mercado anterior, o anterior é encerrado sozinho:
 * - no mesmo dia: vira "feita", com check-out na hora do novo check-in;
 * - de um dia que já passou: vira "não foi" (mesma regra de fechar o dia).
 * Devolve só as visitas que mudaram (a nova primeiro). Se o check-in for inválido, nada muda.
 */
export function checkIn(
  visits: readonly Visit[],
  visitId: string,
  ctx: TransitionContext,
): Visit[] {
  const target = findTarget(visits, visitId)

  const started = transition(target, { type: 'checkIn' }, ctx)

  const closed = openElsewhere(visits, target).map((visit): Visit => {
    if (visit.date < ctx.today) {
      return { ...visit, status: 'not_done', skipReason: NO_CHECKOUT_REASON }
    }
    const checkInAt = visit.checkInAt ?? ctx.now
    return {
      ...visit,
      status: 'done',
      checkInAt,
      checkOutAt: Date.parse(ctx.now) < Date.parse(checkInAt) ? checkInAt : ctx.now,
      note: visit.note ?? AUTO_CHECKOUT_NOTE,
    }
  })

  return [started, ...closed]
}

/**
 * Um evento ainda sem identidade: o que o aparelho quer registrar. O armazenamento local dá a ele o
 * `clientEventId` e o `seq` ao gravá-lo na fila.
 */
export type EventDraft = { visitId: string; occurredAt: string } & ExecutionEvent

export interface CheckInEvents {
  /** O check-in que o repositor fez. */
  event: EventDraft
  /**
   * O que o check-in encerra em outras visitas, já como eventos comuns: o servidor não tem regra
   * entre visitas, então o aparelho grava tudo explícito, na mesma transação do `event`.
   */
  derived: EventDraft[]
}

/**
 * O mesmo que `checkIn`, mas como eventos para a fila offline em vez de visitas já alteradas.
 * Aplicados pelas regras do servidor (`projectVisits`), dão exatamente as visitas de `checkIn`.
 * Se o check-in for inválido, lança e nada é gravado.
 */
export function checkInEvents(
  visits: readonly Visit[],
  visitId: string,
  ctx: TransitionContext,
): CheckInEvents {
  const target = findTarget(visits, visitId)

  transition(target, { type: 'checkIn' }, ctx)

  const derived = openElsewhere(visits, target).map((visit): EventDraft => {
    if (visit.date < ctx.today) {
      return {
        type: 'markNotDone',
        visitId: visit.id,
        occurredAt: ctx.now,
        reason: NO_CHECKOUT_REASON,
      }
    }
    const { checkInAt } = visit
    return {
      type: 'checkOut',
      visitId: visit.id,
      // Nunca antes do check-in: com o relógio do aparelho atrasado, o servidor recusaria.
      occurredAt:
        checkInAt !== null && Date.parse(ctx.now) < Date.parse(checkInAt) ? checkInAt : ctx.now,
      note: visit.note ?? AUTO_CHECKOUT_NOTE,
    }
  })

  return { event: { type: 'checkIn', visitId, occurredAt: ctx.now }, derived }
}
