import type { Meta, StoryObj } from '@storybook/react-vite'
import { VISIT_STATUSES } from '@/domain/types'
import { StatusBadge } from './StatusBadge'

const meta = {
  title: 'Design System/StatusBadge',
  component: StatusBadge,
  args: { status: 'planned' },
} satisfies Meta<typeof StatusBadge>

export default meta
type Story = StoryObj<typeof meta>

export const Planned: Story = { args: { status: 'planned' } }
export const InProgress: Story = { args: { status: 'in_progress' } }
export const Done: Story = { args: { status: 'done' } }
export const NotDone: Story = { args: { status: 'not_done' } }
export const Cancelled: Story = { args: { status: 'cancelled' } }

/** Todos juntos, gerados da lista do domínio: status novo aparece aqui sozinho. */
export const AllStatuses: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      {VISIT_STATUSES.map((status) => (
        <StatusBadge key={status} status={status} />
      ))}
    </div>
  ),
}
