/** Data de calendário "YYYY-MM-DD", sem fuso. Nunca usar Date local para isso. */
export type IsoDate = string

/** 0 = domingo ... 6 = sábado (mesma convenção de Date#getUTCDay). */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

/** admin = quem administra os mercados (o dono); supplier = o fornecedor que reserva estandes. */
export const ROLES = ['admin', 'supplier'] as const
export type Role = (typeof ROLES)[number]

export interface Actor {
  id: string
  role: Role
}
