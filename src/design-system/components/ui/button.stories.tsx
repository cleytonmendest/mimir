import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'

const meta = {
  title: 'Design System/Button',
  component: Button,
  args: { children: 'Fazer check-in' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Outline: Story = { args: { variant: 'outline', children: 'Ver semana' } }
export const Secondary: Story = { args: { variant: 'secondary', children: 'Adiar' } }
export const Ghost: Story = { args: { variant: 'ghost', children: 'Voltar' } }
export const Destructive: Story = { args: { variant: 'destructive', children: 'Cancelar visita' } }
export const Link: Story = { args: { variant: 'link', children: 'Ver histórico' } }
export const Large: Story = { args: { size: 'lg' } }
export const Disabled: Story = { args: { disabled: true } }
