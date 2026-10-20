import { buildAuditEntry, type AuditEntry } from './audit'
import { DomainError } from './errors'
import { keyOf, visitKey } from './keys'
import { assertCan } from './permissions'
import type { Actor, IsoDate, Visit } from './types'

export interface PlanContext {
  actor: Actor
  now: string
  today: IsoDate
  newId: () => string
}

export interface PlanResult {
  /** Lista completa de visitas depois da mudança. A entrada nunca é alterada. */
  visits: Visit[]
  /** Uma entrada por visita que mudou de fato. */
  audit: AuditEntry[]
}

interface Change {
  before: Visit | null
  after: Visit
}

function commit(visits: readonly Visit[], changes: Change[], ctx: PlanContext): PlanResult {
  const byId = new Map(visits.map((visit) => [visit.id, visit]))
  const audit: AuditEntry[] = []

  for (const { before, after } of changes) {
    byId.set(after.id, after)
    const entry = buildAuditEntry({ actor: ctx.actor, at: ctx.now, before, after })
    if (entry !== null) audit.push(entry)
  }

  return { visits: [...byId.values()], audit }
}

function findVisit(visits: readonly Visit[], id: string): Visit {
  const visit = visits.find((candidate) => candidate.id === id)
  if (visit === undefined) throw new DomainError('VISIT_NOT_FOUND', `Visita ${id} não existe`)
  return visit
}

function findByKey(visits: readonly Visit[], repositorId: string, marketId: string, date: IsoDate) {
  const key = visitKey(repositorId, marketId, date)
  return visits.find((candidate) => keyOf(candidate) === key)
}

/** Só se mexe no que ainda vai acontecer: passado e visitas já iniciadas são histórico. */
function assertEditable(visit: Visit, ctx: PlanContext): void {
  assertCan(ctx.actor, 'editPlan', visit)
  if (visit.status !== 'planned') {
    throw new DomainError('VISIT_NOT_EDITABLE', `Visita "${visit.status}" não pode ser alterada`)
  }
  assertNotInPast(visit.date, ctx)
}

function assertNotInPast(date: IsoDate, ctx: PlanContext): void {
  if (date < ctx.today) {
    throw new DomainError('VISIT_NOT_EDITABLE', `${date} já passou e não pode ser planejado`)
  }
}

/** Traz de volta uma visita cancelada (a chave única do dia já está ocupada por ela). */
function reinstate(cancelled: Visit, order: number): Visit {
  return {
    ...cancelled,
    status: 'planned',
    origin: 'exception',
    order,
    carriedFromDate: null,
    checkInAt: null,
    checkOutAt: null,
    skipReason: null,
  }
}

export function addVisit(
  visits: readonly Visit[],
  input: { repositorId: string; marketId: string; date: IsoDate; order: number },
  ctx: PlanContext,
): PlanResult {
  assertCan(ctx.actor, 'editPlan', { repositorId: input.repositorId })
  assertNotInPast(input.date, ctx)

  const existing = findByKey(visits, input.repositorId, input.marketId, input.date)
  if (existing !== undefined) {
    if (existing.status !== 'cancelled') {
      throw new DomainError('DUPLICATE_VISIT', 'Esse mercado já está na agenda desse dia')
    }
    return commit(visits, [{ before: existing, after: reinstate(existing, input.order) }], ctx)
  }

  const created: Visit = {
    id: ctx.newId(),
    repositorId: input.repositorId,
    marketId: input.marketId,
    date: input.date,
    order: input.order,
    status: 'planned',
    origin: 'exception',
    carriedFromDate: null,
    checkInAt: null,
    checkOutAt: null,
    note: null,
    skipReason: null,
  }
  return commit(visits, [{ before: null, after: created }], ctx)
}

export function reorderVisit(
  visits: readonly Visit[],
  visitId: string,
  order: number,
  ctx: PlanContext,
): PlanResult {
  const visit = findVisit(visits, visitId)
  assertEditable(visit, ctx)
  return commit(visits, [{ before: visit, after: { ...visit, order } }], ctx)
}

export function cancelVisit(
  visits: readonly Visit[],
  visitId: string,
  ctx: PlanContext,
): PlanResult {
  const visit = findVisit(visits, visitId)
  assertEditable(visit, ctx)
  return commit(visits, [{ before: visit, after: { ...visit, status: 'cancelled' } }], ctx)
}

/**
 * Remaneja para outro dia. Se a visita veio da rota padrão, ela fica "cancelada"
 * no dia de origem; sem isso, gerar a semana de novo traria o mercado de volta.
 */
export function moveVisitToDate(
  visits: readonly Visit[],
  visitId: string,
  target: { date: IsoDate; order: number },
  ctx: PlanContext,
): PlanResult {
  const visit = findVisit(visits, visitId)
  assertEditable(visit, ctx)
  assertNotInPast(target.date, ctx)

  if (target.date === visit.date) return reorderVisit(visits, visitId, target.order, ctx)

  const occupant = findByKey(visits, visit.repositorId, visit.marketId, target.date)
  if (occupant !== undefined && occupant.status !== 'cancelled') {
    throw new DomainError('DUPLICATE_VISIT', 'Esse mercado já está na agenda desse dia')
  }

  // Visita avulsa (exceção/sobra) não existe na rota padrão: basta mudar de data.
  if (visit.origin !== 'standard' && occupant === undefined) {
    return commit(
      visits,
      [{ before: visit, after: { ...visit, date: target.date, order: target.order } }],
      ctx,
    )
  }

  const tombstone: Visit = { ...visit, status: 'cancelled' }
  const arrival: Visit =
    occupant === undefined
      ? { ...visit, id: ctx.newId(), date: target.date, order: target.order, origin: 'exception' }
      : reinstate(occupant, target.order)

  return commit(
    visits,
    [
      { before: visit, after: tombstone },
      { before: occupant ?? null, after: arrival },
    ],
    ctx,
  )
}

export interface ReopenResult extends PlanResult {
  /**
   * Cópia "adiada" que esta visita já gerou no dia seguinte e que ainda não começou.
   * A tela oferece cancelá-la (cancelVisit) para o mercado não ficar duplicado.
   */
  postponedCopy: Visit | null
}

/** Só o líder reabre o que já foi concluído, não realizado ou cancelado. */
export function reopenVisit(
  visits: readonly Visit[],
  visitId: string,
  ctx: PlanContext,
): ReopenResult {
  assertCan(ctx.actor, 'reopenVisit')
  const visit = findVisit(visits, visitId)
  if (visit.status === 'planned' || visit.status === 'in_progress') {
    throw new DomainError('INVALID_TRANSITION', `Visita "${visit.status}" não precisa ser reaberta`)
  }
  const after: Visit = {
    ...visit,
    status: 'planned',
    checkInAt: null,
    checkOutAt: null,
    skipReason: null,
  }
  const postponedCopy =
    visits.find(
      (candidate) =>
        candidate.origin === 'carryover' &&
        candidate.carriedFromDate === visit.date &&
        candidate.repositorId === visit.repositorId &&
        candidate.marketId === visit.marketId &&
        candidate.status === 'planned',
    ) ?? null
  return { ...commit(visits, [{ before: visit, after }], ctx), postponedCopy }
}
