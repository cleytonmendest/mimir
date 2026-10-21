import type { VisitStatus } from '@/domain/types'
import type { RejectedEvent } from '@/lib/offline/store'
import type { RejectionCode } from '@/lib/supabase/sync-wire'

const ACTIONS = {
  checkIn: 'Check-in',
  checkOut: 'Check-out',
  markNotDone: '"Não fui"',
} as const

/** Como a visita estava no servidor, dito para quem está no mercado (e não conhece "in_progress"). */
const STATUS_NOW: Record<VisitStatus, string> = {
  planned: 'ainda não tinha check-in',
  in_progress: 'já estava em andamento',
  done: 'já estava registrada como feita',
  not_done: 'já estava registrada como "não foi"',
  cancelled: 'foi cancelada pelo líder',
}

function reasonFor(code: RejectionCode, visitStatus: VisitStatus | null): string {
  switch (code) {
    case 'INVALID_TRANSITION':
      return visitStatus === null
        ? 'a visita não estava mais nesse ponto.'
        : `a visita ${STATUS_NOW[visitStatus]}.`
    case 'VISIT_IN_FUTURE':
      return 'a visita é de um dia que ainda não chegou. Confira a data e a hora do celular.'
    case 'VISIT_IN_PAST':
      return 'a visita é de um dia que já passou. O líder precisa remanejá-la.'
    case 'CHECKOUT_BEFORE_CHECKIN':
      return 'o horário de saída ficou antes do de entrada. Confira a hora do celular.'
    case 'REASON_REQUIRED':
      return 'faltou dizer por que não foi.'
    case 'FORBIDDEN':
      return 'esta visita não é sua.'
    case 'VISIT_NOT_FOUND':
      return 'a visita não existe mais.'
    case 'CLOCK_INVALID':
      return 'a hora do seu celular estava adiantada. Ajuste o relógio.'
    case 'ID_CONFLICT':
    case 'INVALID_DATA':
    case 'UNRECOGNIZED':
      return 'o servidor não aceitou este registro. Fale com o líder.'
  }
}

/** "Check-in no Mercado A: a visita foi cancelada pelo líder." */
export function describeRejection(item: RejectedEvent, marketName: string | undefined): string {
  const where = marketName === undefined ? '' : ` no ${marketName}`
  const { code, visitStatus } = item.rejection
  return `${ACTIONS[item.event.type]}${where}: ${reasonFor(code, visitStatus)}`
}
