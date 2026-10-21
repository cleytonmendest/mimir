import { useState } from 'react'
import { SegmentedControl } from '@/design-system/components/SegmentedControl/SegmentedControl'
import type { BookingGateway } from '@/lib/supabase/booking-gateway'
import { AgendaView } from './AgendaView'
import { MarketsView } from './MarketsView'

type Tab = 'agenda' | 'markets'

const TABS = [
  { value: 'agenda', label: 'Agenda' },
  { value: 'markets', label: 'Mercados' },
] as const

/** A área do administrador. No dia a dia ele não precisa fazer nada: só define limites e datas. */
export function AdminScreen({ gateway, now }: { gateway: BookingGateway; now?: () => Date }) {
  const [tab, setTab] = useState<Tab>('agenda')
  const clock = now === undefined ? {} : { now }

  return (
    <section className="mt-6" aria-labelledby="admin-title">
      <h2 id="admin-title" className="font-display text-3xl font-semibold">
        Administração
      </h2>
      <p className="mt-1 mb-3 max-w-[56ch] text-muted-foreground">
        Os fornecedores reservam sozinhos. Aqui você define o limite de estandes de cada mercado,
        fecha datas e consulta quem reservou.
      </p>
      <SegmentedControl label="Área" options={TABS} value={tab} onChange={setTab} />
      {tab === 'agenda' ? (
        <AgendaView gateway={gateway} {...clock} />
      ) : (
        <MarketsView gateway={gateway} {...clock} />
      )}
    </section>
  )
}
