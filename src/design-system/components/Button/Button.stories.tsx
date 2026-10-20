import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './Button'

const meta = {
  title: 'Design System/Button',
  component: Button,
  args: { children: 'Fazer check-in' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Primary: Story = { args: { variant: 'primary' } }
export const Secondary: Story = { args: { variant: 'secondary', children: 'Ver semana' } }
export const Danger: Story = { args: { variant: 'danger', children: 'Cancelar visita' } }
export const Disabled: Story = { args: { disabled: true } }
