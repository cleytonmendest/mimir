import type { IsoDate } from '@/domain/types'

/** Um instante e o dia em que ele cai no calendário do aparelho, lidos juntos para nunca discordarem. */
export interface Moment {
  now: string
  today: IsoDate
}

export type Clock = () => Moment

const pad = (value: number) => String(value).padStart(2, '0')

/**
 * A data no calendário do aparelho, não em UTC: é o dia que o repositor está vivendo. (O domínio
 * trabalha só com datas "AAAA-MM-DD" já prontas, justamente para não depender de fuso.)
 */
export function localIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const systemClock: Clock = () => {
  const date = new Date()
  return { now: date.toISOString(), today: localIsoDate(date) }
}
