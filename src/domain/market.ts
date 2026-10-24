import { MAX_CAPACITY, MIN_CAPACITY } from './booking'

export const MAX_NAME_LENGTH = 100
export const MAX_ADDRESS_LENGTH = 200

export interface MarketInput {
  name: string
  address: string | null
  capacity: number
}

export type MarketValidation = { ok: true; value: MarketInput } | { ok: false; message: string }

/** A mensagem para quem digitou o nome do mercado, ou null se está bom. Espaços das pontas não contam. */
export function validateMarketName(raw: string): string | null {
  const name = raw.trim()
  if (name === '') return 'Informe o nome do mercado.'
  if (name.length > MAX_NAME_LENGTH) return `O nome pode ter até ${MAX_NAME_LENGTH} caracteres.`
  return null
}

/** O endereço é opcional: só o tamanho é conferido. */
export function validateMarketAddress(raw: string): string | null {
  if (raw.trim().length > MAX_ADDRESS_LENGTH) {
    return `O endereço pode ter até ${MAX_ADDRESS_LENGTH} caracteres.`
  }
  return null
}

/**
 * Confere o que o administrador digitou ao cadastrar ou editar um mercado. Espaços das pontas saem,
 * endereço vazio vira "sem endereço". A mensagem é para quem digitou. O banco repete as regras
 * (nome não vazio, limite de 1 a 20): esta conferência só poupa a ida ao servidor. Cada campo tem
 * a sua conferência (acima), que as telas usam ao sair do campo; esta junta todas, no envio.
 */
export function validateMarketInput(raw: {
  name: string
  address: string
  capacity: number
}): MarketValidation {
  const problem = validateMarketName(raw.name) ?? validateMarketAddress(raw.address)
  if (problem !== null) return { ok: false, message: problem }
  const address = raw.address.trim()
  if (
    !Number.isInteger(raw.capacity) ||
    raw.capacity < MIN_CAPACITY ||
    raw.capacity > MAX_CAPACITY
  ) {
    return {
      ok: false,
      message: `O limite deve ser um número de ${MIN_CAPACITY} a ${MAX_CAPACITY} estandes por dia.`,
    }
  }
  return {
    ok: true,
    value: {
      name: raw.name.trim(),
      address: address === '' ? null : address,
      capacity: raw.capacity,
    },
  }
}

/**
 * O dia com mais reservas ativas, a partir das contagens da disponibilidade do mercado (uma por
 * dia). Serve para avisar o administrador quando ele reduz o limite abaixo do que já está
 * reservado. Em empate vale o dia mais cedo; sem nenhuma reserva, não há dia mais cheio.
 */
export function busiestDay(
  days: readonly { day: string; booked: number }[],
): { day: string; count: number } | null {
  let best: { day: string; count: number } | null = null
  for (const { day, booked } of days) {
    if (booked <= 0) continue
    if (best === null || booked > best.count || (booked === best.count && day < best.day)) {
      best = { day, count: booked }
    }
  }
  return best
}
