import { addDays, weekDates } from '@/domain/dates'
import { DomainError } from '@/domain/errors'
import { checkInEvents, type EventDraft } from '@/domain/execution'
import { projectVisits } from '@/domain/projection'
import { evaluateTransition, type ExecutionEvent } from '@/domain/status'
import type { Actor, IsoDate, Visit } from '@/domain/types'
import { generateWeek } from '@/domain/week'
import type { UserSession } from '@/lib/offline/runtime'
import { OfflineStoreError, type StoreView } from '@/lib/offline/store'
import type { SyncState } from '@/lib/offline/sync-engine'
import { ConfigError } from '@/lib/supabase/errors'
import type { Market } from '@/lib/supabase/mappers'
import type { VisitsGateway } from '@/lib/supabase/visits-gateway'
import { systemClock, type Clock } from './clock'
import { describeRejection } from './explain'

/**
 * Estado e ações da tela "Hoje", sem React: a tela só desenha o que está aqui.
 *
 * O repositor trabalha sobre uma cópia local: o que o servidor mostrou da última vez, mais o que ele
 * já fez e ainda não foi enviado. Cada ação vira um evento na fila do aparelho (instantâneo, com ou
 * sem sinal) e o motor de sincronização o leva ao servidor quando puder. As regras (quem pode o quê,
 * o que um check-in encerra, como se gera a semana) vêm do domínio; aqui só se orquestra.
 */

/** Uma recusa do servidor que a pessoa ainda precisa ver, já em português. */
export interface RejectionNotice {
  id: string
  text: string
}

export type TodayState =
  | { status: 'loading' }
  | { status: 'failed'; message: string }
  | {
      status: 'ready'
      /** O dia em que a lista foi carregada. */
      day: IsoDate
      /** Visitas dos últimos dias e da semana, como o repositor as vê (servidor mais o ainda não enviado). */
      visits: readonly Visit[]
      markets: ReadonlyMap<string, Market>
      /** Visita com uma ação sendo guardada agora: enquanto houver uma, as demais ações esperam. */
      busyVisitId: string | null
      notice: string | null
      /** Visitas com algo registrado ainda não enviado. */
      unsentVisitIds: ReadonlySet<string>
      /** Recusas do servidor que a pessoa ainda não dispensou. */
      rejections: readonly RejectionNotice[]
      sync: SyncState
      unsent: number
      lastSyncAt: string | null
      clockOffsetMs: number | null
      /** Quando a lista foi lida do servidor pela última vez (hora do aparelho). */
      fetchedAt: string | null
      /** O servidor não respondeu agora: a lista é a que estava guardada no aparelho. */
      stale: boolean
    }

export type TodayReady = Extract<TodayState, { status: 'ready' }>

export interface TodayController {
  getState: () => TodayState
  subscribe: (listener: () => void) => () => void
  /** Liga os avisos do motor de envio e carrega o dia. Devolve a função que desliga. */
  start: () => () => void
  load: () => Promise<void>
  checkIn: (visitId: string) => Promise<void>
  checkOut: (visitId: string, note: string) => Promise<void>
  markNotDone: (visitId: string, reason: string) => Promise<void>
  dismissNotice: () => void
  dismissRejection: (id: string) => Promise<void>
  /** "Enviar agora": o motor tenta já, mesmo esperando para repetir. */
  syncNow: () => Promise<void>
  /** Quantos registros deste aparelho ainda não foram enviados. */
  unsentCount: () => Promise<number>
}

/** Quantos dias para trás se procura visita que ficou aberta (check-in sem check-out). */
const LOOKBACK_DAYS = 14

const OFFLINE_MESSAGE =
  'Não foi possível conectar ao servidor. Verifique a internet e tente de novo.'
const STORAGE_MESSAGE =
  'Não foi possível guardar neste aparelho. Feche outros apps ou libere espaço e tente de novo.'
const NEW_DAY_MESSAGE = 'Um novo dia começou. Atualizamos a lista.'

/** As visitas de hoje que o repositor ainda precisa ver, na ordem da rota. Cancelada não é com ele. */
export function todaysVisits(state: TodayReady): Visit[] {
  return state.visits
    .filter((visit) => visit.date === state.day && visit.status !== 'cancelled')
    .sort((a, b) => a.order - b.order)
}

function describeLoadFailure(error: unknown): string {
  if (error instanceof OfflineStoreError) return STORAGE_MESSAGE
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
  session: Pick<UserSession, 'store' | 'engine'>
  clock?: Clock
  newId?: () => string
}): TodayController {
  const { actor, gateway } = deps
  const { store, engine } = deps.session
  const clock = deps.clock ?? systemClock
  const newId = deps.newId ?? (() => crypto.randomUUID())

  let state: TodayState = { status: 'loading' }
  const listeners = new Set<() => void>()
  // Só vale o resultado da última carga pedida (o React em modo estrito pede duas ao abrir).
  let lastLoad = 0
  let lastRefresh = 0

  function set(next: TodayState) {
    state = next
    for (const listener of listeners) listener()
  }

  function patchReady(patch: Partial<TodayReady>) {
    if (state.status === 'ready') set({ ...state, ...patch })
  }

  /** O que a tela mostra, montado a partir do que o aparelho tem guardado. Null se ainda não há cópia. */
  function readyFrom(
    view: StoreView,
    base: Pick<TodayReady, 'day' | 'notice' | 'busyVisitId' | 'stale'>,
  ): TodayReady | null {
    if (view.snapshot === null) return null
    const { visits } = projectVisits({
      visits: view.snapshot.visits,
      pending: view.pending,
      actor,
    })
    const markets = new Map(view.snapshot.markets.map((market) => [market.id, market]))
    const marketOf = (visitId: string) =>
      markets.get(view.snapshot?.visits.find((visit) => visit.id === visitId)?.marketId ?? '')
    return {
      status: 'ready',
      ...base,
      visits,
      markets,
      unsentVisitIds: new Set(view.pending.map((event) => event.visitId)),
      rejections: view.rejected.map((item) => ({
        id: item.event.clientEventId,
        text: describeRejection(item, marketOf(item.event.visitId)?.name),
      })),
      sync: engine.state(),
      unsent: view.pending.length,
      lastSyncAt: view.lastSyncAt,
      clockOffsetMs: view.clockOffsetMs,
      fetchedAt: view.snapshot.fetchedAt,
    }
  }

  function carry(): Pick<TodayReady, 'notice' | 'busyVisitId' | 'stale'> {
    return state.status === 'ready'
      ? { notice: state.notice, busyVisitId: state.busyVisitId, stale: state.stale }
      : { notice: null, busyVisitId: null, stale: false }
  }

  /** Relê o aparelho e atualiza a tela, sem mexer no dia, no aviso nem no que está sendo guardado. */
  async function refresh(): Promise<void> {
    if (state.status !== 'ready') return
    const mine = ++lastRefresh
    const view = await store.read()
    if (mine !== lastRefresh || state.status !== 'ready') return
    const next = readyFrom(view, { day: state.day, ...carry() })
    if (next !== null) set(next)
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
    return { visits, markets, route }
  }

  async function load(): Promise<void> {
    const mine = ++lastLoad
    const today = clock().today

    let view: StoreView
    try {
      view = await store.read()
    } catch (error) {
      if (mine === lastLoad) set({ status: 'failed', message: describeLoadFailure(error) })
      return
    }
    if (mine !== lastLoad) return

    // Primeiro o que o aparelho já tem: a lista aparece na hora, com ou sem sinal.
    const local = readyFrom(view, { day: today, ...carry(), stale: false })
    if (local !== null) set(local)
    else if (state.status !== 'ready') set({ status: 'loading' })
    // Sincroniza ao abrir. A cópia que vem do servidor logo abaixo respeita o que ele responder.
    void engine.sync()

    try {
      const fresh = await fetchDay(today)
      if (mine !== lastLoad) return
      await store.saveSnapshot(
        {
          visits: fresh.visits,
          markets: fresh.markets,
          route: fresh.route,
          fetchedAt: clock().now,
        },
        view.revision,
      )
      const latest = await store.read()
      if (mine !== lastLoad) return
      const next = readyFrom(latest, { day: today, ...carry(), stale: false })
      if (next !== null) set(next)
    } catch (error) {
      if (mine !== lastLoad) return
      if (state.status === 'ready') patchReady({ stale: true })
      else set({ status: 'failed', message: describeLoadFailure(error) })
    }
  }

  /** Guarda uma ação na fila do aparelho e manda o motor enviá-la. A tela já mostra o resultado local. */
  async function perform(
    visitId: string,
    plan: (visits: readonly Visit[], moment: ReturnType<Clock>) => EventDraft[],
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

      const drafts = plan(ready.visits, moment)
      await store.enqueue(drafts)
      await refresh()
      void engine.sync()
    } catch (error) {
      patchReady({
        notice:
          error instanceof DomainError
            ? error.message
            : error instanceof OfflineStoreError
              ? STORAGE_MESSAGE
              : 'Não foi possível registrar. Tente de novo.',
      })
    } finally {
      patchReady({ busyVisitId: null })
    }
  }

  /** A mesma conferência do servidor, antes de guardar: ação inválida nem entra na fila. */
  function drafted(
    visits: readonly Visit[],
    visitId: string,
    event: ExecutionEvent,
    moment: ReturnType<Clock>,
  ): EventDraft[] {
    const result = evaluateTransition(mustFind(visits, visitId), event, {
      actor,
      now: moment.now,
      today: moment.today,
    })
    if (!result.ok) throw new DomainError(result.code, result.message)
    return [{ ...event, visitId, occurredAt: moment.now }]
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    start() {
      const unsubscribe = engine.subscribe((sync) => {
        patchReady({ sync })
        // Terminou um envio (ou falhou): relê a fila para a contagem e as recusas acompanharem.
        if (sync.phase !== 'syncing') void refresh()
      })
      void load()
      return unsubscribe
    },

    load,

    checkIn: (visitId) =>
      perform(visitId, (visits, { now, today }) => {
        // O check-in e o que ele encerra em outras visitas entram juntos, ou nada entra.
        const { event, derived } = checkInEvents(visits, visitId, { actor, now, today })
        return [event, ...derived]
      }),

    checkOut: (visitId, note) =>
      perform(visitId, (visits, moment) => {
        const text = note.trim()
        return drafted(
          visits,
          visitId,
          text === '' ? { type: 'checkOut' } : { type: 'checkOut', note: text },
          moment,
        )
      }),

    markNotDone: (visitId, reason) =>
      perform(visitId, (visits, moment) =>
        drafted(visits, visitId, { type: 'markNotDone', reason }, moment),
      ),

    dismissNotice: () => {
      patchReady({ notice: null })
    },

    dismissRejection: async (id) => {
      await store.dismissRejected(id)
      await refresh()
    },

    syncNow: async () => {
      patchReady({ sync: await engine.sync() })
      await refresh()
    },

    unsentCount: async () => (await store.pending()).length,
  }
}
