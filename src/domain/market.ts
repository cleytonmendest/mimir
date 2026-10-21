import { MAX_CAPACITY, MIN_CAPACITY } from './booking'

export const MAX_NAME_LENGTH = 100
export const MAX_ADDRESS_LENGTH = 200

export interface MarketInput {
  name: string
  address: string | null
  capacity: number
}

export type MarketValidation = { ok: true; value: MarketInput } | { ok: false; message: string }

/**
 * Confere o que o administrador digitou ao cadastrar ou editar um mercado. Espaços das pontas saem,
 * endereço vazio vira "sem endereço". A mensagem é para quem digitou. O banco repete as regras
 * (nome não vazio, limite de 1 a 20): esta conferência só poupa a ida ao servidor.
 */
export function validateMarketInput(raw: {
  name: string
  address: string
  capacity: number
}): MarketValidation {
  const name = raw.name.trim()
  const address = raw.address.trim()
  if (name === '') return { ok: false, message: 'Informe o nome do mercado.' }
  if (name.length > MAX_NAME_LENGTH) {
    return { ok: false, message: `O nome pode ter até ${MAX_NAME_LENGTH} caracteres.` }
  }
  if (address.length > MAX_ADDRESS_LENGTH) {
    return { ok: false, message: `O endereço pode ter até ${MAX_ADDRESS_LENGTH} caracteres.` }
  }
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
    value: { name, address: address === '' ? null : address, capacity: raw.capacity },
  }
}

/**
 * O maior número de reservas ativas num mesmo dia de um mercado, a partir das reservas dele. Serve
 * para avisar o administrador quando ele reduz o limite abaixo do que já está reservado.
 */
export function busiestDay(days: readonly string[]): { day: string; count: number } | null {
  const counts = new Map<string, number>()
  for (const day of days) counts.set(day, (counts.get(day) ?? 0) + 1)
  let best: { day: string; count: number } | null = null
  for (const [day, count] of counts) {
    if (best === null || count > best.count || (count === best.count && day < best.day)) {
      best = { day, count }
    }
  }
  return best
}
