import type { Meta, StoryObj } from '@storybook/react-vite'
import { ChevronLeft, Plus, X } from 'lucide-react'
import { IconButton } from './IconButton'

const meta = {
  title: 'Design System/IconButton',
  component: IconButton,
  args: { label: 'Mês anterior', children: <ChevronLeft /> },
} satisfies Meta<typeof IconButton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Desligado: Story = { args: { disabled: true } }
export const SemBorda: Story = {
  args: { label: 'Limpar busca', variant: 'ghost', children: <X /> },
}
export const TooltipCurto: Story = {
  args: {
    label: 'Aumentar: Limite de estandes por dia, Loja 07 - Leblon',
    tooltip: 'Aumentar',
    children: <Plus />,
  },
}
