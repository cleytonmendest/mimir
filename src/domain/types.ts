/** Data de calendário "YYYY-MM-DD", sem fuso. Nunca usar Date local para isso. */
export type IsoDate = string

/** 0 = domingo ... 6 = sábado (mesma convenção de Date#getUTCDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export const ROLES = ['repositor', 'leader'] as const
export type Role = (typeof ROLES)[number]

export const VISIT_STATUSES = ['planned', 'in_progress', 'done', 'not_done', 'cancelled'] as const
export type VisitStatus = (typeof VISIT_STATUSES)[number]

/** De onde a visita veio: rota padrão, exceção manual ou sobra de um dia anterior. */
export const VISIT_ORIGINS = ['standard', 'exception', 'carryover'] as const
export type VisitOrigin = (typeof VISIT_ORIGINS)[number]

export interface Actor {
  id: string
  role: Role
}

export interface StandardRouteEntry {
  repositorId: string
  weekday: Weekday
  marketId: string
  order: number
}

export interface Visit {
  id: string
  repositorId: string
  marketId: string
  date: IsoDate
  order: number
  status: VisitStatus
  origin: VisitOrigin
  carriedFromDate: IsoDate | null
  checkInAt: string | null
  checkOutAt: string | null
  note: string | null
  skipReason: string | null
}
