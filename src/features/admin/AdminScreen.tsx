import { useState } from 'react'
import { SegmentedControl } from '@/design-system/components/SegmentedControl/SegmentedControl'
import type { AccessGateway } from '@/lib/supabase/access-gateway'
import type { BookingGateway } from '@/lib/supabase/booking-gateway'
import { AgendaView } from './AgendaView'
import { MarketsView } from './MarketsView'
import { SettingsView } from './SettingsView'
import { SuppliersView } from './SuppliersView'

type Tab = 'agenda' | 'markets' | 'suppliers' | 'settings'

const TABS = [
  { value: 'agenda', label: 'Agenda' },
  { value: 'markets', label: 'Mercados' },
  { value: 'suppliers', label: 'Fornecedores' },
  { value: 'settings', label: 'Configurações' },
] as const

/** A área do administrador. No dia a dia ele não precisa fazer nada: só define limites e datas. */
export function AdminScreen({
  gateway,
  access,
  now,
  origin,
}: {
  gateway: BookingGateway
  access: AccessGateway
  now?: () => Date
  /** De onde o app é servido; os links de ativação e convite apontam para cá. */
  origin?: string
}) {
  const [tab, setTab] = useState<Tab>('agenda')
  const clock = now === undefined ? {} : { now }
  const where = origin === undefined ? {} : { origin }

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
      {tab === 'agenda' && <AgendaView gateway={gateway} {...clock} />}
      {tab === 'markets' && <MarketsView gateway={gateway} {...clock} />}
      {tab === 'suppliers' && <SuppliersView gateway={access} {...where} />}
      {tab === 'settings' && <SettingsView gateway={access} {...where} />}
    </section>
  )
}
