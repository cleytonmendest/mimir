import type { Meta, StoryObj } from '@storybook/react-vite'
import { SegmentedControl } from './SegmentedControl'

const meta = {
  title: 'Design System/SegmentedControl',
  component: SegmentedControl,
  args: {
    label: 'Cadastro de fornecedores',
    value: 'closed',
    options: [
      { value: 'closed', label: 'Fechado' },
      { value: 'code', label: 'Com código' },
      { value: 'open', label: 'Livre' },
    ],
    onChange: () => undefined,
  },
} satisfies Meta<typeof SegmentedControl>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const SegundaOpcao: Story = { args: { value: 'code' } }
