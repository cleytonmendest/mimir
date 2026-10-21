import { useEffect, useState, useSyncExternalStore } from 'react'
import { Button } from '@/design-system/components/ui/button'
import type { Clock } from './clock'
import { formatLongDate } from './format'
import { createTodayController, todaysVisits } from './today-controller'
import { VisitCard } from './VisitCard'
import type { UserProfile } from '@/lib/supabase/mappers'
import type { VisitsGateway } from '@/lib/supabase/visits-gateway'

/** As visitas de hoje do repositor: ver em ordem, fazer check-in e check-out, ou dizer que não foi. */
export function TodayScreen({
  profile,
  gateway,
  clock,
}: {
  profile: UserProfile
  gateway: VisitsGateway
  clock?: Clock
}) {
  const [controller] = useState(() => createTodayController({ actor: profile, gateway, clock }))
  const state = useSyncExternalStore(controller.subscribe, controller.getState)

  useEffect(() => {
    void controller.load()
  }, [controller])

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
        </>
      )}
    </section>
  )
}
