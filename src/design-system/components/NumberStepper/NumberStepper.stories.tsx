import type { Meta, StoryObj } from '@storybook/react-vite'
import { NumberStepper } from './NumberStepper'

const meta = {
  title: 'Design System/NumberStepper',
  component: NumberStepper,
  args: {
    value: 3,
    min: 1,
    max: 20,
    label: 'Limite de estandes por dia, Mercado Central',
    unit: 'por dia',
    onChange: () => undefined,
  },
} satisfies Meta<typeof NumberStepper>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const NoMinimo: Story = { args: { value: 1 } }
export const NoMaximo: Story = { args: { value: 20 } }
