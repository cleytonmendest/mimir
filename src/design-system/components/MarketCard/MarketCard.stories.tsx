import type { Meta, StoryObj } from '@storybook/react-vite'
import { MarketCard } from './MarketCard'

const meta = {
  title: 'Design System/MarketCard',
  component: MarketCard,
  args: { name: 'Mercado Central', subtitle: 'Centro', selected: false, onSelect: () => undefined },
} satisfies Meta<typeof MarketCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Selecionado: Story = { args: { selected: true } }
export const ComSelo: Story = {
  args: {
    badge: (
      <>
        <b className="block text-base font-semibold text-foreground tabular-nums">5</b>
        <span>estandes</span>
      </>
    ),
  },
}
export const ComRodape: Story = {
  args: {
    selected: true,
    children: (
      <>
        <span>3 estandes por dia</span>
        <span>12 vagas livres nos próximos 7 dias</span>
      </>
    ),
  },
}
