import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'

const meta = {
  title: 'Design System/Button',
  component: Button,
  args: { children: 'Reservar este dia' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Outline: Story = { args: { variant: 'outline', children: 'Ver agenda' } }
export const Secondary: Story = { args: { variant: 'secondary', children: 'Manter' } }
export const Ghost: Story = { args: { variant: 'ghost', children: 'Voltar' } }
export const Destructive: Story = { args: { variant: 'destructive', children: 'Cancelar reserva' } }
export const Link: Story = { args: { variant: 'link', children: 'Ver detalhes' } }
export const Large: Story = { args: { size: 'lg' } }
export const Disabled: Story = { args: { disabled: true } }
