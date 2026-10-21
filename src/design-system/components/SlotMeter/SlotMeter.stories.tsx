import type { Meta, StoryObj } from '@storybook/react-vite'
import { SlotMeter } from './SlotMeter'

const meta = {
  title: 'Design System/SlotMeter',
  component: SlotMeter,
  args: { booked: 1, capacity: 3 },
} satisfies Meta<typeof SlotMeter>

export default meta
type Story = StoryObj<typeof meta>

export const Livre: Story = { args: { booked: 0 } }
export const EmParte: Story = {}
export const Lotado: Story = { args: { booked: 3 } }
export const AcimaDoLimite: Story = { args: { booked: 4, capacity: 3 } }
export const Grande: Story = { args: { size: 'lg' } }
export const Decorativo: Story = { args: { decorative: true } }
