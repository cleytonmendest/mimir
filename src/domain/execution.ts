import { NO_CHECKOUT_REASON } from './carryover'
import { DomainError } from './errors'
import { transition, type TransitionContext } from './status'
import type { Visit } from './types'

export const AUTO_CHECKOUT_NOTE = 'Check-out automático ao iniciar outra visita'

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
  const target = visits.find((visit) => visit.id === visitId)
  if (target === undefined) throw new DomainError('VISIT_NOT_FOUND', `Visita ${visitId} não existe`)

  const started = transition(target, { type: 'checkIn' }, ctx)

  const closed = visits
    .filter(
      (visit) =>
        visit.id !== target.id &&
        visit.repositorId === target.repositorId &&
        visit.status === 'in_progress',
    )
    .map((visit): Visit => {
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
