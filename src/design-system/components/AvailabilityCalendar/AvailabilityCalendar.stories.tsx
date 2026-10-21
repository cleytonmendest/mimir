import type { Meta, StoryObj } from '@storybook/react-vite'
import { AvailabilityCalendar } from './AvailabilityCalendar'

const TODAY = '2026-10-21'

/** Dias de exemplo: lotado, em parte, fechado e um dia com reserva do próprio fornecedor. */
const DAYS = [
  { day: '2026-10-22', booked: 3, closed: false, mine: false },
  { day: '2026-10-23', booked: 0, closed: false, mine: false },
  { day: '2026-10-24', booked: 1, closed: false, mine: false },
  { day: '2026-10-26', booked: 0, closed: true, mine: false },
  { day: '2026-10-29', booked: 2, closed: false, mine: true },
  { day: '2026-10-30', booked: 2, closed: false, mine: false },
]

const meta = {
  title: 'Design System/AvailabilityCalendar',
  component: AvailabilityCalendar,
  args: {
    month: { year: 2026, month: 10 },
    today: TODAY,
    capacity: 3,
    days: DAYS,
    selected: '2026-10-24',
    showMine: true,
    subtitle: 'Mercado Central',
    onSelect: () => undefined,
    onMonthChange: () => undefined,
  },
} satisfies Meta<typeof AvailabilityCalendar>

export default meta
type Story = StoryObj<typeof meta>

export const Fornecedor: Story = {}
export const Administrador: Story = { args: { showMine: false } }
export const SemDiaEscolhido: Story = { args: { selected: null } }
export const ProximoMes: Story = { args: { month: { year: 2026, month: 11 }, days: [] } }
export const UltimoMesDaJanela: Story = { args: { month: { year: 2026, month: 12 }, days: [] } }
