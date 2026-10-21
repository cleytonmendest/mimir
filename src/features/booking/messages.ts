import { BOOKING_WINDOW_DAYS, type BookingRefusal, type CancelRefusal } from '@/domain/booking'
import { RequestFailure } from '@/lib/supabase/errors'

/** O que a pessoa lê quando o servidor recusa. Sem código técnico, com o que fazer em seguida. */

export function describeBookingRefusal(code: BookingRefusal | 'UNRECOGNIZED'): string {
  switch (code) {
    case 'FULL':
      return 'Não deu: a última vaga deste dia acabou de ser ocupada por outro fornecedor. Nenhuma reserva foi feita. Escolha outro dia.'
    case 'CLOSED':
      return 'Este dia está fechado para reservas neste mercado. Escolha outro dia.'
    case 'OUT_OF_WINDOW':
      return `Só dá para reservar de amanhã até ${BOOKING_WINDOW_DAYS} dias à frente.`
    case 'MARKET_INACTIVE':
      return 'Este mercado não está aceitando reservas.'
    case 'FORBIDDEN':
      return 'Esta conta não pode reservar estandes.'
    case 'UNRECOGNIZED':
      return 'Não foi possível reservar agora. Atualize a página e tente de novo.'
  }
}

export function describeCancelRefusal(code: CancelRefusal | 'UNRECOGNIZED'): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'Não encontramos essa reserva. Ela pode já ter sido cancelada.'
    case 'PAST':
      return 'Reservas de dias que já passaram não podem ser canceladas.'
    case 'FORBIDDEN':
      return 'Esta conta não pode cancelar reservas.'
    case 'UNRECOGNIZED':
      return 'Não foi possível cancelar agora. Atualize a página e tente de novo.'
  }
}

/** Falha que não é recusa de negócio: sem sinal, sessão, servidor. */
export function describeFailure(error: unknown): string {
  if (error instanceof RequestFailure) {
    switch (error.code) {
      case 'NETWORK':
        return 'Sem conexão com o servidor. Confira a internet e tente de novo.'
      case 'AUTH':
        return 'Sua sessão não vale mais. Saia e entre de novo.'
      case 'SERVER':
        return 'O servidor não conseguiu atender agora. Tente de novo em instantes.'
      case 'INVALID_RESPONSE':
        return 'O servidor respondeu algo que este app não entende. Atualize a página.'
    }
  }
  return 'Algo deu errado. Tente de novo.'
}
