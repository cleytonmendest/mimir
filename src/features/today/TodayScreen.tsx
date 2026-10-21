import { useEffect, useState, useSyncExternalStore } from 'react'
import { SyncStatus } from '@/design-system/components/SyncStatus/SyncStatus'
import { Button } from '@/design-system/components/ui/button'
import type { UserSession } from '@/lib/offline/runtime'
import type { UserProfile } from '@/lib/supabase/mappers'
import type { VisitsGateway } from '@/lib/supabase/visits-gateway'
import type { Clock } from './clock'
import { Diagnostics } from './Diagnostics'
import { formatLongDate, formatTime } from './format'
import { summarizeSync } from './sync-summary'
import { createTodayController, todaysVisits, type TodayReady } from './today-controller'
import { VisitCard } from './VisitCard'

/** Acima disso o relógio do celular atrapalha os horários e a pessoa precisa saber. */
const CLOCK_WARNING_MS = 5 * 60_000

/** As visitas de hoje do repositor: ver em ordem, fazer check-in e check-out, ou dizer que não foi. */
export function TodayScreen({
  profile,
  gateway,
  session,
  clock,
}: {
  profile: UserProfile
  gateway: VisitsGateway
  session: Pick<UserSession, 'store' | 'engine' | 'deviceId'>
  clock?: Clock
}) {
  const [controller] = useState(() =>
    createTodayController({ actor: profile, gateway, session, clock }),
  )
  const state = useSyncExternalStore(controller.subscribe, controller.getState)

  useEffect(() => controller.start(), [controller])

  return (
    <section aria-labelledby="today-title" className="mt-6">
      <h2 id="today-title" className="text-xl font-semibold">
        Hoje
      </h2>

      {state.status === 'loading' && (
        <p role="status" className="mt-4 text-muted-foreground">
          Carregando visitas…
        </p>
      )}

      {state.status === 'failed' && (
        <div className="mt-4 grid gap-4">
          <p role="alert" className="text-destructive">
            {state.message}
          </p>
          <div>
            <Button
              onClick={() => {
                void controller.load()
              }}
            >
              Tentar de novo
            </Button>
          </div>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <p className="text-muted-foreground">{formatLongDate(state.day)}</p>

          <SyncPanel
            state={state}
            onSyncNow={() => {
              void controller.syncNow()
            }}
          />

          {state.stale && (
            <p className="mt-3 text-sm text-muted-foreground">
              Sem conexão com o servidor. Esta é a lista guardada neste aparelho
              {state.fetchedAt === null ? '' : ` (lida às ${formatTime(state.fetchedAt)})`}.
            </p>
          )}

          {state.clockOffsetMs !== null && Math.abs(state.clockOffsetMs) > CLOCK_WARNING_MS && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              O relógio do seu celular está {Math.round(Math.abs(state.clockOffsetMs) / 60_000)} min{' '}
              {state.clockOffsetMs > 0 ? 'atrasado' : 'adiantado'}. Ajuste a hora para os horários
              saírem certos.
            </p>
          )}

          {state.rejections.map((rejection) => (
            <div
              key={rejection.id}
              className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-destructive p-3"
            >
              <p role="alert" className="text-destructive">
                {rejection.text}
              </p>
              <Button
                variant="ghost"
                onClick={() => {
                  void controller.dismissRejection(rejection.id)
                }}
              >
                Entendi
              </Button>
            </div>
          ))}

          {state.notice !== null && (
            <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-destructive p-3">
              <p role="alert" className="text-destructive">
                {state.notice}
              </p>
              <Button variant="ghost" onClick={controller.dismissNotice}>
                Fechar
              </Button>
            </div>
          )}

          {todaysVisits(state).length === 0 ? (
            <p className="mt-4 text-muted-foreground">Nenhuma visita para hoje.</p>
          ) : (
            <ul aria-label="Visitas de hoje" className="mt-4 grid gap-3">
              {todaysVisits(state).map((visit) => (
                <VisitCard
                  key={visit.id}
                  visit={visit}
                  market={state.markets.get(visit.marketId)}
                  busy={state.busyVisitId === visit.id}
                  locked={state.busyVisitId !== null}
                  unsent={state.unsentVisitIds.has(visit.id)}
                  onCheckIn={() => {
                    void controller.checkIn(visit.id)
                  }}
                  onCheckOut={(note) => {
                    void controller.checkOut(visit.id, note)
                  }}
                  onNotDone={(reason) => {
                    void controller.markNotDone(visit.id, reason)
                  }}
                />
              ))}
            </ul>
          )}

          <Diagnostics
            version={__APP_VERSION__}
            deviceId={session.deviceId}
            unsent={state.unsent}
            sync={state.sync}
            lastSyncAt={state.lastSyncAt}
            fetchedAt={state.fetchedAt}
            clockOffsetMs={state.clockOffsetMs}
          />
        </>
      )}
    </section>
  )
}

function SyncPanel({ state, onSyncNow }: { state: TodayReady; onSyncNow: () => void }) {
  const summary = summarizeSync({
    state: state.sync,
    unsent: state.unsent,
    lastSyncAt: state.lastSyncAt,
  })
  return (
    <SyncStatus
      tone={summary.tone}
      title={summary.title}
      detail={summary.detail}
      action={
        summary.action === 'syncNow' ? { label: 'Enviar agora', onClick: onSyncNow } : undefined
      }
    />
  )
}
