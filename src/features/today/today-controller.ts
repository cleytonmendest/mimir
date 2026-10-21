import { addDays, weekDates } from '@/domain/dates'
import { DomainError } from '@/domain/errors'
import { checkIn as startVisit } from '@/domain/execution'
import { transition } from '@/domain/status'
import type { Actor, IsoDate, Visit } from '@/domain/types'
import { generateWeek } from '@/domain/week'
import { ConfigError, DataError } from '@/lib/supabase/errors'
import type { Market } from '@/lib/supabase/mappers'
import type { VisitsGateway } from '@/lib/supabase/visits-gateway'
import { systemClock, type Clock, type Moment } from './clock'

/**
 * Estado e ações da tela "Hoje", sem React: a tela só desenha o que está aqui. Todas as regras
 * (quem pode o quê, o que um check-in encerra, como se gera a semana) vêm do domínio; este arquivo
 * só orquestra: carrega, aplica a regra, grava no servidor e guarda o resultado.
 */

export type TodayState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | {
      status: 'ready'
      /** O dia em que a lista foi carregada. */
      day: IsoDate
      /** Visitas dos últimos dias e da semana: o domínio precisa delas para encerrar as que ficaram abertas. */
      visits: readonly Visit[]
      markets: ReadonlyMap<string, Market>
      /** Visita sendo gravada agora: enquanto houver uma, as demais ações esperam. */
      busyVisitId: string | null
      notice: string | null
    }

export interface TodayController {
  getState: () => TodayState
  subscribe: (listener: () => void) => () => void
  load: () => Promise<void>
  checkIn: (visitId: string) => Promise<void>
  checkOut: (visitId: string, note: string) => Promise<void>
  markNotDone: (visitId: string, reason: string) => Promise<void>
  dismissNotice: () => void
}

/** Quantos dias para trás se procura visita que ficou aberta (check-in sem check-out). */
const LOOKBACK_DAYS = 14

const OFFLINE_MESSAGE =
  'Não foi possível conectar ao servidor. Verifique a internet e tente de novo.'
const SAVE_FAILED_MESSAGE = 'Não foi possível salvar. Verifique a internet e tente de novo.'
const CONFLICT_MESSAGE = 'Esta visita mudou enquanto você a abria. Atualizamos a lista.'
const NEW_DAY_MESSAGE = 'Um novo dia começou. Atualizamos a lista.'

/** As visitas de hoje que o repositor ainda precisa ver, na ordem da rota. Cancelada não é com ele. */
export function todaysVisits(state: Extract<TodayState, { status: 'ready' }>): Visit[] {
  return state.visits
    .filter((visit) => visit.date === state.day && visit.status !== 'cancelled')
    .sort((a, b) => a.order - b.order)
}

function describeLoadFailure(error: unknown): string {
  // Falta de configuração é erro de quem implantou o app: vale mostrar o texto real.
  return error instanceof ConfigError ? error.message : OFFLINE_MESSAGE
}

function mustFind(visits: readonly Visit[], visitId: string): Visit {
  const visit = visits.find((candidate) => candidate.id === visitId)
  if (visit === undefined) {
    throw new DomainError('VISIT_NOT_FOUND', `Visita ${visitId} não existe`)
  }
  return visit
}

export function createTodayController(deps: {
  actor: Actor
  gateway: VisitsGateway
  clock?: Clock
  newId?: () => string
}): TodayController {
  const { actor, gateway } = deps
  const clock = deps.clock ?? systemClock
  const newId = deps.newId ?? (() => crypto.randomUUID())

  let state: TodayState = { status: 'loading' }
  const listeners = new Set<() => void>()
  // Só vale o resultado da última carga pedida (o React em modo estrito pede duas ao abrir).
  let lastLoad = 0

  function set(next: TodayState) {
    state = next
    for (const listener of listeners) listener()
  }

  function patchReady(patch: Partial<Extract<TodayState, { status: 'ready' }>>) {
    if (state.status === 'ready') set({ ...state, ...patch })
  }

  async function fetchDay(today: IsoDate) {
    const range = {
      from: addDays(today, -LOOKBACK_DAYS),
      to: weekDates(today).at(-1) ?? today,
      repositorId: actor.id,
    }
    const [route, markets, existing] = await Promise.all([
      gateway.listStandardRoute(actor.id),
      gateway.listMarkets(),
      gateway.listVisits(range),
    ])

    // Abrir a semana cria o que a rota padrão manda e ainda não existe. É seguro repetir (e
    // abrir em dois aparelhos): o servidor ignora o que já existe, e depois lemos o que ficou.
    const created = generateWeek({
      route,
      existing,
      repositorId: actor.id,
      weekOf: today,
      today,
      newId,
    })
    let visits = existing
    if (created.length > 0) {
      await gateway.createVisits(created)
      visits = await gateway.listVisits(range)
    }
    return { visits, markets: new Map(markets.map((market) => [market.id, market])) }
  }

  async function load(): Promise<void> {
    const mine = ++lastLoad
    // Recarregar com a lista na tela não a esconde: só a primeira carga (ou depois de falhar) mostra "carregando".
    if (state.status !== 'ready') set({ status: 'loading' })

    const today = clock().today
    try {
      const { visits, markets } = await fetchDay(today)
      if (mine !== lastLoad) return
      set({
        status: 'ready',
        day: today,
        visits,
        markets,
        busyVisitId: null,
        notice: state.status === 'ready' ? state.notice : null,
      })
    } catch (error) {
      if (mine !== lastLoad) return
      if (state.status === 'ready') {
        patchReady({ busyVisitId: null, notice: describeLoadFailure(error) })
      } else {
        set({ status: 'failed', message: describeLoadFailure(error) })
      }
    }
  }

  async function handleActionError(error: unknown): Promise<void> {
    if (error instanceof DomainError) {
      patchReady({ notice: error.message })
      return
    }
    if (error instanceof DataError && error.code === 'CONFLICT') {
      patchReady({ notice: CONFLICT_MESSAGE })
      await load()
      return
    }
    // Pode ter gravado só parte das mudanças: relê o servidor para a tela refletir o que valeu.
    patchReady({ notice: SAVE_FAILED_MESSAGE })
    await load()
  }

  /** Aplica uma ação: roda a regra do domínio, grava e só então atualiza a tela. */
  async function perform(
    visitId: string,
    plan: (visits: readonly Visit[], moment: Moment) => Visit[],
  ): Promise<void> {
    if (state.status !== 'ready' || state.busyVisitId !== null) return
    const ready = state
    set({ ...ready, busyVisitId: visitId, notice: null })

    try {
      const moment = clock()
      if (moment.today !== ready.day) {
        // A tela ficou aberta de um dia para o outro: o que ela mostra já não vale para agir.
        await load()
        patchReady({ notice: NEW_DAY_MESSAGE })
        return
      }

      const updated = plan(ready.visits, moment)
      await gateway.saveChanges(
        updated.map((after) => ({ before: mustFind(ready.visits, after.id), after })),
      )

      const byId = new Map(updated.map((visit) => [visit.id, visit]))
      patchReady({ visits: ready.visits.map((visit) => byId.get(visit.id) ?? visit) })
    } catch (error) {
      await handleActionError(error)
    } finally {
      patchReady({ busyVisitId: null })
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    load,

    checkIn: (visitId) =>
      perform(visitId, (visits, { now, today }) => {
        // O domínio devolve a visita iniciada primeiro e depois as que ela encerrou. Grava-se
        // as encerradas antes: se falhar no meio, o pior é uma visita fechada a mais, nunca duas abertas.
        const changed = startVisit(visits, visitId, { actor, now, today })
        return [...changed.slice(1), ...changed.slice(0, 1)]
      }),

    checkOut: (visitId, note) =>
      perform(visitId, (visits, { now, today }) => {
        const text = note.trim()
        return [
          transition(
            mustFind(visits, visitId),
            { type: 'checkOut', note: text === '' ? undefined : text },
            { actor, now, today },
          ),
        ]
      }),

    markNotDone: (visitId, reason) =>
      perform(visitId, (visits, { now, today }) => [
        transition(
          mustFind(visits, visitId),
          { type: 'markNotDone', reason },
          { actor, now, today },
        ),
      ]),

    dismissNotice: () => {
      patchReady({ notice: null })
    },
  }
}
