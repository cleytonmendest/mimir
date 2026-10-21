import { companyDate } from '@/domain/dates'
import type { IsoDate } from '@/domain/types'

/** Um instante e o dia dele no fuso da empresa, lidos juntos para nunca discordarem. */
export interface Moment {
  now: string
  today: IsoDate
}

export type Clock = () => Moment

/**
 * O "hoje" é o de Brasília, não o do aparelho: celular com o fuso trocado (ou de viagem) continua
 * vendo as visitas do dia certo. Só o relógio do aparelho conta; o fuso dele, não.
 */
export const systemClock: Clock = () => {
  const date = new Date()
  return { now: date.toISOString(), today: companyDate(date) }
}
